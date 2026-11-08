import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { assertRecordAvailable, recordKey, transitionRecord } from "./record-lifecycle";

interface Job { workspaceId: string; signature: string; pending?: Promise<unknown>; root?: string; checkout?: string; started: Set<string>; completed: Map<string, unknown> }
export interface GitOperationScope {
  bind(root: string): Promise<void>;
  step<T>(name: string, work: () => Promise<T>, recover?: () => Promise<T | undefined>): Promise<T>;
}
const jobs = new Map<string, Job>();
const workspaces = new Map<string, Job>();
const roots = new Map<string, Job>();
const revisions = new Map<string, number>();
const advance = (root: string) => revisions.set(root, (revisions.get(root) ?? 0) + 1);

/** Synchronous native-execution admission also covers aliased workspaces. */
export function assertCheckoutAvailable(location: string): void {
  let resolved: string;
  try { resolved = realpathSync(location); } catch { resolved = path.resolve(location); }
  const root = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (roots.has(root)) throw new Error("Another Git action is already in progress for this checkout");
}

/** A read started before a checkout mutation cannot publish after it. */
export async function captureCheckoutRevision(location: string): Promise<() => boolean> {
  const resolved = await realpath(location).catch(() => path.resolve(location));
  const root = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const accepted = revisions.get(root) ?? 0;
  return () => (revisions.get(root) ?? 0) === accepted;
}
let admission: "open" | "closing" | "closed" = "open";
let stopping: Promise<void> | undefined;

export function assertGitOperationsOpen(): void {
  if (admission !== "open") throw new Error("Git operations are shutting down");
}

export function openGitOperations(): void {
  if (admission === "open") return;
  if (admission !== "closed") throw new Error("Git operations are still shutting down");
  admission = "open"; stopping = undefined;
}

export function shutdownGitOperations(): Promise<void> {
  if (stopping) return stopping;
  admission = "closing";
  stopping = (async () => {
    await Promise.allSettled([...workspaces.values()].flatMap((job) => job.pending ? [job.pending] : []));
    jobs.clear(); roots.clear(); workspaces.clear(); revisions.clear(); admission = "closed";
  })();
  return stopping;
}

/** A logical Git action owns its workspace and checkout before any mutation.
 * Equal in-flight identities join; competing actions fail before staging. */
export function runGitOperation<T, P extends { workspaceId: string; operationId?: string }>(input: P, action: string, work: (scope: GitOperationScope) => Promise<T>): Promise<T> {
  if (admission !== "open") return Promise.reject(new Error("Git operations are shutting down"));
  const { operationId, ...payload } = input;
  if (operationId !== undefined && (typeof operationId !== "string" || !operationId || operationId.length > 128)) return Promise.reject(new Error("Invalid Git operation ID"));
  const signature = JSON.stringify([action, payload], (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  const id = operationId ?? randomUUID(), prior = jobs.get(id);
  if (prior && (prior.workspaceId !== input.workspaceId || prior.signature !== signature)) return Promise.reject(new Error("Git operation ID belongs to another action"));
  if (prior?.pending) return prior.pending as Promise<T>;
  if (workspaces.has(input.workspaceId)) return Promise.reject(new Error("Another Git action is already in progress for this workspace"));
  try { assertRecordAvailable(recordKey("workspace", input.workspaceId)); } catch (error) { return Promise.reject(error); }
  if (!prior && jobs.size >= 500) return Promise.reject(new Error("Too many retained Git operations; restart the backend before starting another"));
  const job: Job = prior ?? { workspaceId: input.workspaceId, signature, started: new Set(), completed: new Map() };
  jobs.set(id, job); workspaces.set(input.workspaceId, job);
  const pending = transitionRecord(recordKey("workspace", input.workspaceId), Symbol(action), async () => {
      return work({ async bind(location) {
        const resolved = await realpath(location).catch(() => path.resolve(location));
        const root = process.platform === "win32" ? resolved.toLowerCase() : resolved;
        const identity = await stat(resolved).then((value) => `${value.dev}:${value.ino}`).catch(() => root);
        if (job.checkout && job.checkout !== identity) throw new Error("Repository was replaced since this Git action started");
        job.checkout = identity;
        if (job.root && job.root !== root) throw new Error("Repository changed since this Git action started");
        if (roots.has(root) && roots.get(root) !== job) throw new Error("Another Git action is already in progress for this checkout");
        job.root = root; roots.set(root, job); advance(root);
      }, async step(name, execute, recover) {
        if (job.completed.has(name)) return job.completed.get(name) as Awaited<ReturnType<typeof execute>>;
        if (job.started.has(name) && recover) {
          const value = await recover();
          if (value !== undefined) { job.completed.set(name, value); return value; }
        }
        job.started.add(name);
        const value = await execute(); job.completed.set(name, value); return value;
      } });
  }).finally(() => {
      if (workspaces.get(input.workspaceId) === job) workspaces.delete(input.workspaceId);
      if (job.root && roots.get(job.root) === job) { roots.delete(job.root); advance(job.root); }
      job.pending = undefined;
      if (!operationId) jobs.delete(id);
  });
  job.pending = pending;
  return pending;
}
