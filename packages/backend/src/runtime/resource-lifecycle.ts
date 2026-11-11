export interface ResourceScope {
  readonly signal: AbortSignal;
  assertActive(): void;
  defer(release: () => void | Promise<void>): void;
  observe(signal?: AbortSignal): void;
}

/** Failed rollback still owns resources; callers can finish it before retrying startup. */
export class ResourceCleanupError extends Error {
  constructor(readonly errors: unknown[], message: string, readonly close: () => Promise<void>) {
    super(message); this.name = "ResourceCleanupError";
  }
}

/** One opener/closer and a reverse-order resource journal. Failed release keeps
 * its dependencies owned until a later close succeeds. */
export function createResourceLifecycle<T>(label: string) {
  let phase: "idle" | "opening" | "ready" | "closing" | "blocked" = "idle";
  let generation = 0, value: T;
  let identity: string | undefined;
  let cancellation: AbortController | undefined;
  let opening: Promise<T> | undefined, closing: Promise<void> | undefined;
  const releases: Array<() => void | Promise<void>> = [];
  async function drain() {
    while (releases.length) { await releases.at(-1)!(); releases.pop(); }
  }
  const lifecycle = {
    get ready() { return phase === "ready"; },
    start(acquire: (scope: ResourceScope) => Promise<T>, requestedIdentity?: string): Promise<T> {
      if (phase === "closing" || phase === "blocked") return Promise.reject(new Error(`${label} is closing; finish close before opening`));
      if ((opening || phase === "ready") && requestedIdentity !== identity) return Promise.reject(new Error(`${label} is already opening or ready for a different resource`));
      if (opening) return opening;
      if (phase === "ready") return Promise.resolve(value);
      phase = "opening"; closing = undefined;
      identity = requestedIdentity;
      const revision = ++generation;
      cancellation = new AbortController();
      const scope: ResourceScope = {
        signal: cancellation.signal,
        assertActive() {
          if (generation !== revision || phase !== "opening") throw new Error(`${label} initialization was canceled by close`);
        },
        defer(release) { releases.push(release); },
        observe(signal) {
          if (!signal) return;
          if (signal.aborted) throw new Error(`${label} initialization was canceled`);
          const abort = () => { void lifecycle.close().catch((error) => console.error(`${label} close failed`, error)); };
          signal.addEventListener("abort", abort, { once: true });
          releases.push(() => signal.removeEventListener("abort", abort));
        },
      };
      opening = Promise.resolve().then(async () => {
        try {
          scope.assertActive();
          const result = await acquire(scope);
          scope.assertActive(); value = result; phase = "ready";
          return result;
        } catch (error) {
          if (error instanceof ResourceCleanupError) releases.push(error.close);
          try { await drain(); }
          catch (cleanupError) {
            if (phase !== "closing") phase = "blocked";
            throw new ResourceCleanupError([error, cleanupError], `${label} initialization and cleanup failed`, () => lifecycle.close());
          }
          if (phase !== "closing") phase = "idle";
          throw error;
        } finally { opening = undefined; }
      });
      return opening;
    },
    close(): Promise<void> {
      if (closing) return closing;
      phase = "closing"; generation++;
      const pending = opening;
      const result = Promise.resolve().then(async () => {
        await pending?.catch(() => {});
        await drain(); phase = "idle";
      });
      closing = result;
      cancellation?.abort();
      void result.catch(() => { if (closing === result) { closing = undefined; phase = "blocked"; } });
      return result;
    },
  };
  return lifecycle;
}
