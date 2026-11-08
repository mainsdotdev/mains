import { assertRecordAvailable, recordKey, transitionRecord } from "../../runtime/record-lifecycle";
import { claimRunResponse } from "./run-lifecycle";

const pending = new Map<string, Promise<unknown>>();

/** An Undo owns its run before reading the turn. Equal concurrent requests
 * join; Continue and retirement cannot pass its native/metadata boundary. */
export function runTurnUndo<T>(runId: string, turnId: number, work: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([runId, turnId]);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  let release: () => void;
  try { assertRecordAvailable(recordKey("run", runId)); release = claimRunResponse(runId); }
  catch (error) { return Promise.reject(error); }
  const result = transitionRecord(recordKey("run", runId), Symbol("undo-turn"), work).finally(() => {
    release(); if (pending.get(key) === result) pending.delete(key);
  });
  pending.set(key, result);
  return result;
}
