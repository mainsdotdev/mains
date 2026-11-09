import { createResourceLifecycle, type ResourceScope } from "../../runtime/resource-lifecycle";

export interface BridgeServiceScope extends ResourceScope {
  current(): boolean;
  assertCurrent(): void;
}

/** Startup, callback admission and mutations share one owner. Close retires
 * admission immediately; its journal retains failed cleanup for retry. */
export function createBridgeServiceLifecycle() {
  const resources = createResourceLifecycle<void>("Bridge service");
  let owner: { active: boolean } | undefined;
  let operations: Promise<unknown> = Promise.resolve();
  let closing = false;
  const unavailable = () => new Error("Bridge service is closing or unavailable");
  return {
    get active() { return !!owner?.active && !closing; },
    get closing() { return closing; },
    start(acquire: (scope: BridgeServiceScope) => Promise<void>) {
      if (closing) return Promise.reject(unavailable());
      return resources.start(async (scope) => {
        const lease = { active: true }; owner = lease;
        const current = () => owner === lease && lease.active && !scope.signal.aborted;
        scope.defer(() => { lease.active = false; if (owner === lease) owner = undefined; });
        try {
          await acquire({ ...scope, current, assertCurrent() { if (!current()) throw unavailable(); } });
        } catch (error) { lease.active = false; throw error; }
      });
    },
    run<T>(work: () => Promise<T>): Promise<T> {
      const lease = owner;
      if (!lease?.active || closing) return Promise.reject(unavailable());
      const result = operations.then(() => {
        if (owner !== lease || !lease.active) throw unavailable();
        return work();
      });
      operations = result.catch(() => {});
      return result;
    },
    drain: () => operations.then(() => {}),
    stop() {
      closing = true; if (owner) owner.active = false;
      const result = resources.close();
      void result.then(() => { closing = false; }, () => {});
      return result;
    },
  };
}
