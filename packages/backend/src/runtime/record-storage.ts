import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ResourceCleanupError } from "./resource-lifecycle";

/** A staged tree belongs to one deletion. Settlement follows successful I/O,
 * so failed purge/restore can be retried without overwriting a replacement. */
export function stageRecordStorage(source: string) {
  let identity: fs.Stats;
  try { identity = fs.lstatSync(source); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { commit() {}, restore() {} }; throw error; }
  const trash = path.join(path.dirname(source), ".trash");
  fs.mkdirSync(trash, { recursive: true });
  const staged = path.join(trash, `${path.basename(source)}-${randomUUID()}`);
  fs.renameSync(source, staged);
  let settled = false;
  const exists = (location: string) => {
    try { return fs.lstatSync(location); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const assertIdentity = () => {
    const current = exists(staged);
    if (current && (current.dev !== identity.dev || current.ino !== identity.ino)) throw new Error("Staged record storage was replaced");
    return current;
  };
  return {
    commit() {
      if (settled) return;
      if (assertIdentity()) fs.rmSync(staged, { recursive: true, force: true });
      settled = true;
    },
    restore() {
      if (settled) return;
      if (!assertIdentity()) throw new Error("Staged record storage is missing");
      if (exists(source)) throw new Error("Cannot restore record storage over a replacement");
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.renameSync(staged, source); settled = true;
    },
  };
}

/** Rollback does not stop at the first failed tree. Its journal stays available
 * for an explicit retry or host shutdown instead of losing the staged data. */
export async function restoreRecordStorage(staged: ReturnType<typeof stageRecordStorage>[], cause: unknown): Promise<void> {
  const close = async () => {
    const errors: unknown[] = [];
    for (const storage of [...staged].reverse()) {
      try { storage.restore(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new ResourceCleanupError(errors, "Record deletion failed; storage rollback is pending", close);
  };
  try { await close(); }
  catch (error) { throw new ResourceCleanupError([cause, error], "Record deletion failed; storage rollback is pending", close); }
}
