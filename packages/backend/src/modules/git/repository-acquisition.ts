import fs from "node:fs/promises";
import path from "node:path";
import type { BigIntStats } from "node:fs";
import { WORKSPACE_CLONE_CANCELED } from "@mains/contracts/workspace-intake";
import { ResourceCleanupError } from "../../runtime/resource-lifecycle";

async function identify(location: string) {
  return fs.lstat(location, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}
const same = (current: BigIntStats | null, expected: BigIntStats) =>
  current?.isDirectory() && current.dev === expected.dev && current.ino === expected.ino;

/** reserve -> private acquisition -> publish; failure -> cleanup/blocked.
 * Git never owns the public destination. Publication removes only an empty,
 * identity-matched reservation. Cleanup journals independent releases and keeps
 * failed releases retryable, without adopting a replacement or a user's files. */
export async function acquireRepository<T>(destination: string, work: (staging: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error(WORKSPACE_CLONE_CANCELED);
  await fs.mkdir(destination);
  let reservation: BigIntStats | undefined, staging: string | undefined, stagedIdentity: BigIntStats | undefined;
  let cleaning: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    if (cleaning) return cleaning;
    const pending = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      try {
        if (staging && stagedIdentity) {
          if (same(await identify(staging), stagedIdentity)) await fs.rm(staging, { recursive: true, force: true });
          staging = undefined;
        }
      } catch (error) { errors.push(error); }
      try {
        if (reservation) {
          if (same(await identify(destination), reservation)) await fs.rmdir(destination).catch((error: NodeJS.ErrnoException) => {
            if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
          });
          reservation = undefined;
        }
      } catch (error) { errors.push(error); }
      if (errors.length) throw new ResourceCleanupError(errors, "Repository acquisition cleanup failed", cleanup);
    });
    cleaning = pending;
    void pending.catch(() => { if (cleaning === pending) cleaning = undefined; });
    return pending;
  };
  try {
    reservation = await fs.lstat(destination, { bigint: true });
    if (signal?.aborted) throw new Error(WORKSPACE_CLONE_CANCELED);
    staging = await fs.mkdtemp(path.join(path.dirname(destination), ".mains-repo-"));
    stagedIdentity = await fs.lstat(staging, { bigint: true });
    const result = await work(staging);
    if (signal?.aborted) throw new Error(WORKSPACE_CLONE_CANCELED);
    if (!same(await identify(destination), reservation)) throw new Error("Repository destination changed during acquisition");
    await fs.rmdir(destination); reservation = undefined;
    await fs.rename(staging, destination); staging = undefined;
    return result;
  } catch (error) {
    try { await cleanup(); }
    catch (cleanupError) { throw new ResourceCleanupError([error, cleanupError], "Repository acquisition cleanup failed", cleanup); }
    if (signal?.aborted) throw new Error(WORKSPACE_CLONE_CANCELED);
    throw error;
  }
}
