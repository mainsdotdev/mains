/** A discovery read is shared until its last consumer leaves. Mutations never use this owner. */
export function createCatalogRead<T>(load: (signal: AbortSignal) => Promise<T>) {
  type Flight = { controller: AbortController; promise: Promise<T>; consumers: number; settled: boolean };
  let current: Flight | undefined;
  return {
    invalidate() { current = undefined; },
    read(signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (!current) {
        const controller = new AbortController();
        const flight: Flight = { controller, consumers: 0, settled: false,
          promise: Promise.resolve().then(() => { controller.signal.throwIfAborted(); return load(controller.signal); }),
        };
        current = flight;
        const settle = () => {
          flight.settled = true;
          if (current === flight) current = undefined;
        };
        void flight.promise.then(settle, settle);
      }
      const flight = current;
      flight.consumers++;
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (succeeded: boolean, value: unknown) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", abort);
          flight.consumers--;
          if (!flight.consumers && !flight.settled) {
            if (current === flight) current = undefined;
            flight.controller.abort();
          }
          if (succeeded) resolve(value as T); else reject(value);
        };
        const abort = () => finish(false, signal!.reason);
        signal?.addEventListener("abort", abort, { once: true });
        void flight.promise.then((value) => finish(true, value), (error) => finish(false, error));
      });
    },
  };
}

/** Abandon a non-cancellable native RPC without dropping its shared in-flight identity. */
export function awaitCatalogResult<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}
