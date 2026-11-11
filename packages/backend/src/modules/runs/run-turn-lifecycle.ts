import type { WorkRunUsage } from "../../../shared/adapter.types";
import type { RunSessionResult } from "./run-lifecycle";
import type { TurnWrites } from "./turn-attribution";

export interface TurnBaseline {
  tree: Promise<string | null>;
  at: number;
  writes: TurnWrites;
}

export interface ClosedRunTurn {
  id: number;
  baseline: TurnBaseline;
  endTree: Promise<string | null>;
  usage?: WorkRunUsage;
  outcome?: RunSessionResult["status"];
}

/** One owner for turn identity, index and the shared closing/opening snapshot.
 * An accepted input retains its turn even if the later artifact write fails. */
export function createRunTurnLifecycle(effects: {
  seedIndex: number;
  captureTree(): Promise<string | null>;
  open(index: number, prompt?: string): Promise<number>;
  opened(id: number, initial: boolean): Promise<void>;
  close(turn: ClosedRunTurn): Promise<void>;
}) {
  const capture = (): TurnBaseline => ({ at: Date.now(), tree: effects.captureTree(), writes: { paths: new Set(), unnamed: false } });
  let baseline = capture();
  let boundary: TurnBaseline | null = null;
  let id: number | null = null, index = effects.seedIndex;
  let tail = Promise.resolve(), ready = Promise.resolve();
  let initialized = false, closed = false;
  const inputs = new Map<string, number>();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.then(() => {}, () => {});
    return result;
  }
  async function closeCurrent(usage?: WorkRunUsage, outcome?: RunSessionResult["status"]) {
    if (id === null) return;
    boundary ??= capture();
    await effects.close({ id, baseline, endTree: boundary.tree, usage, outcome });
    id = null; baseline = boundary; boundary = null;
  }
  function start(prompt?: string, inputId?: string): Promise<number> {
    return serialize(async () => {
      if (closed) throw new Error("Run turn ownership is closed");
      const existing = inputId ? inputs.get(inputId) : undefined;
      if (existing !== undefined) return existing;
      await closeCurrent();
      const initial = index === effects.seedIndex;
      const next = await effects.open(index + 1, prompt);
      id = next; index++;
      if (inputId) inputs.set(inputId, next);
      await effects.opened(next, initial);
      return next;
    });
  }
  return {
    get id() { return id; },
    get baseline() { return baseline; },
    get ready() { return ready; },
    initialize(wait: Promise<void>, prompt: string) {
      if (!initialized) { initialized = true; ready = wait.then(() => start(prompt)).then(() => {}); }
      return ready;
    },
    start,
    finish(usage?: WorkRunUsage, outcome?: RunSessionResult["status"]) {
      return serialize(async () => {
        if (closed) return;
        await closeCurrent(usage, outcome); closed = true;
      });
    },
  };
}
