export interface ResourceSnapshot<T> { value: T; fetchedAt: number }
export interface ResourceReadContext { signal: AbortSignal; assertCurrent(): void; retainUntilSettled(): void }

/** Abandon one consumer without inventing native cancellation for its source. */
export function awaitResourceResult<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

/** Keyed discovery ownership. Native I/O and response validation stay in adapters. */
export function createAsyncResourceLifecycle<T>(options: {
  ttlMs?: number;
  retryMs?: number;
  prepare?(key: string, context: ResourceReadContext): Promise<ResourceSnapshot<T> | undefined>;
  load?(key: string, context: ResourceReadContext): Promise<T>;
  /** Some provider DTOs carry a fallback/error instead of rejecting the read. */
  cacheIf?(value: T): boolean;
  publish?(key: string, snapshot: ResourceSnapshot<T>, context: ResourceReadContext): Promise<void> | void;
}) {
  type Flight = { controller: AbortController; promise: Promise<ResourceSnapshot<T>>; consumers: number; settled: boolean; retained: boolean };
  type Entry = { snapshot?: ResourceSnapshot<T>; prepared: boolean; retryAt: number; error?: unknown; flight?: Flight };
  const entries = new Map<string, Entry>();
  const publications = new Map<string, Promise<unknown>>();
  let closed = false;
  const retired = () => new DOMException("This discovery cache was retired.", "AbortError");
  const fresh = (snapshot?: ResourceSnapshot<T>) => snapshot !== undefined &&
    Date.now() >= snapshot.fetchedAt && Date.now() - snapshot.fetchedAt < (options.ttlMs ?? 0);

  function read(key = "", { signal, force = false, load }: {
    signal?: AbortSignal;
    force?: boolean;
    /** For native handles acquired before discovery admission (e.g. an SDK client). */
    load?: (context: ResourceReadContext) => Promise<T>;
  } = {}): Promise<ResourceSnapshot<T>> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (closed) return Promise.reject(retired());
    let entry = entries.get(key);
    if (!entry) { entry = { prepared: false, retryAt: 0 }; entries.set(key, entry); }
    const owned = entry;
    if (!owned.flight) {
      if (!force && fresh(owned.snapshot)) return Promise.resolve(owned.snapshot!);
      if (!force && Date.now() < owned.retryAt) return Promise.reject(owned.error);
      const controller = new AbortController();
      const context: ResourceReadContext = { signal: controller.signal, assertCurrent() {
        controller.signal.throwIfAborted();
        if (closed || entries.get(key) !== owned || owned.flight !== flight) throw retired();
      }, retainUntilSettled() { context.assertCurrent(); flight.retained = true; } };
      const flight: Flight = { controller, consumers: 0, settled: false, retained: false,
        promise: Promise.resolve().then(async () => {
          context.assertCurrent();
          if (!owned.prepared) {
            const seed = await options.prepare?.(key, context); context.assertCurrent();
            owned.prepared = true;
            if (seed && Number.isFinite(seed.fetchedAt) && seed.fetchedAt >= 0 && seed.fetchedAt <= Date.now()) owned.snapshot = seed;
            if (!force && fresh(owned.snapshot)) return owned.snapshot!;
          }
          const loader = load ?? (options.load && ((context: ResourceReadContext) => options.load!(key, context)));
          if (!loader) throw new Error("No discovery loader was provided.");
          const value = await loader(context); context.assertCurrent();
          const snapshot = { value, fetchedAt: Date.now() };
          if (options.cacheIf && !options.cacheIf(value)) return snapshot;
          // A replacement cannot publish ahead of an older admitted native write.
          const previous = publications.get(key) ?? Promise.resolve();
          const publication = previous.catch(() => {}).then(async () => {
            context.assertCurrent(); await options.publish?.(key, snapshot, context); context.assertCurrent();
            owned.snapshot = snapshot; owned.retryAt = 0; owned.error = undefined;
          });
          publications.set(key, publication);
          const clear = () => { if (publications.get(key) === publication) publications.delete(key); };
          void publication.then(clear, clear);
          await publication;
          return snapshot;
        }).catch((error: unknown) => {
          if (!controller.signal.aborted && entries.get(key) === owned && owned.flight === flight) {
            owned.error = error; owned.retryAt = Date.now() + (options.retryMs ?? 0);
          }
          throw error;
        }),
      };
      owned.flight = flight;
      const settle = () => { flight.settled = true; if (owned.flight === flight) owned.flight = undefined; };
      void flight.promise.then(settle, settle);
    }
    const flight = owned.flight;
    flight.consumers++;
    return new Promise<ResourceSnapshot<T>>((resolve, reject) => {
      let settled = false;
      const finish = (success: boolean, value: unknown) => {
        if (settled) return;
        settled = true; signal?.removeEventListener("abort", abort); flight.controller.signal.removeEventListener("abort", retire);
        flight.consumers--;
        if (!flight.consumers && !flight.settled && !flight.retained) {
          if (owned.flight === flight) owned.flight = undefined;
          flight.controller.abort();
        }
        if (success) resolve(value as ResourceSnapshot<T>); else reject(value);
      };
      const abort = () => finish(false, signal!.reason);
      const retire = () => finish(false, flight.controller.signal.reason);
      signal?.addEventListener("abort", abort, { once: true });
      flight.controller.signal.addEventListener("abort", retire, { once: true });
      void flight.promise.then((value) => finish(true, value), (error) => finish(false, error));
    });
  }
  function invalidate(key?: string) {
    const targets = key === undefined ? [...entries.entries()] : [...entries.entries()].filter(([candidate]) => candidate === key);
    for (const [id, entry] of targets) { entries.delete(id); entry.flight?.controller.abort(retired()); }
  }
  return { read, invalidate,
    peek: (key = "") => entries.get(key)?.snapshot,
    dispose() { closed = true; invalidate(); },
  };
}
