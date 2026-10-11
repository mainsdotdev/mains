import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";

/** Keep history/aggregation work cooperative with provider events and IPC. */
export function createStatsWorkBudget() {
  let deadline = performance.now() + 6;
  return () => {
    if (performance.now() < deadline) return;
    return setImmediate().then(() => { deadline = performance.now() + 6; });
  };
}

export function finishStatsWork<T>(steps: Generator<void, T>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export async function runStatsWork<T>(steps: Generator<void, T>): Promise<T> {
  const pause = createStatsWorkBudget();
  let next = steps.next();
  while (!next.done) {
    const yielding = pause();
    if (yielding) await yielding;
    next = steps.next();
  }
  return next.value;
}
