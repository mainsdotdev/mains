export type TabResourcePhase = "live" | "preparing" | "prepared" | "released";
export interface TabResourcePreparation<Result> {
  result: Promise<Result>;
  current: () => boolean;
}

/** One preparation per live resource, shared by suspend and close callers.
 * Success is retained until release/replacement; failure or veto permits retry.
 * Only a current preparation may commit a suspension or remove a logical tab.
 * Releasing/replacing an owner retires its callbacks, not a replacement owner.
 */
export function createTabResourceLifecycle<Result>(accepted: (result: Result) => boolean = () => true) {
  let owner: object | undefined;
  let generation = 0;
  let phase: TabResourcePhase = "live";
  let preparation: TabResourcePreparation<Result> | undefined;
  return {
    get phase() { return phase; },
    get pending() { return phase === "preparing" ? preparation?.result ?? null : null; },
    release(resource?: object) {
      if (resource && owner !== resource) return;
      generation++; owner = undefined; preparation = undefined; phase = "released";
    },
    prepare(resource: object, action: (current: () => boolean) => Promise<Result>): TabResourcePreparation<Result> {
      if (owner === resource && preparation) return preparation;
      owner = resource;
      const revision = ++generation;
      const current = () => owner === resource && generation === revision;
      let resolve!: (result: Result) => void, reject!: (error: unknown) => void;
      const result = new Promise<Result>((yes, no) => { resolve = yes; reject = no; });
      const request = { result, current };
      preparation = request; phase = "preparing";
      // Claim before action: native close and state callbacks can fire inline.
      try {
        void action(current).then((value) => {
          if (current()) {
            phase = accepted(value) ? "prepared" : "live";
            if (phase === "live") preparation = undefined;
          }
          resolve(value);
        }, (error: unknown) => {
          if (current()) { phase = "live"; preparation = undefined; }
          reject(error);
        });
      } catch (error) {
        if (current()) { phase = "live"; preparation = undefined; }
        reject(error);
      }
      return request;
    },
  };
}
