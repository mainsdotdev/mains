import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { cloneRepositoryName, WORKSPACE_CLONE_CANCELED, type CancelWorkspaceClonePayload, type WorkspaceIntakePayload, type WorkspaceIntakeSource } from "@mains/contracts/workspace-intake";
import { gitService } from "../git";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { ResourceCleanupError } from "../../runtime/resource-lifecycle";
import type { CreateWorkspacePayload } from "./workspace.dto";

type CloneResult = Awaited<ReturnType<typeof gitService.cloneRepo>>;
type CloneOutcome = { status: "succeeded" } | { status: "canceled" } | { status: "failed"; error: unknown };
interface Checkpoint {
  accountId: string;
  sourceKey: string;
  result: CloneResult;
  identity: { dev: bigint; ino: bigint };
  workspaceId: string;
  registration?: { input: CreateWorkspacePayload; identity: { dev: bigint; ino: bigint } };
}
interface IntakeScope extends WorkspaceIntakePayload {
  workspaceId: string;
  resumingRegistration: boolean;
  acquireClone(): Promise<CloneResult>;
  prepareRegistration(work: () => Promise<CreateWorkspacePayload>): Promise<CreateWorkspacePayload>;
}
interface IntakeOwner {
  accountId: string;
  source: WorkspaceIntakeSource;
  phase: "acquiring" | "canceling" | "importing" | "succeeded" | "failed" | "canceled";
  controller: AbortController;
  acquired: Promise<void>;
  settleAcquired(): void;
  outcome?: CloneOutcome;
  cloning?: Promise<CloneResult>;
  checkpoint?: Checkpoint;
  finished: Promise<void>;
  finish(): void;
  workspaceId: string;
}
let admission: "open" | "closing" | "blocked" | "closed" = "open";
let stopping: Promise<void> | undefined;
const owners = new Set<IntakeOwner>();
const identities = new Map<string, IntakeOwner>();
const destinations = new Map<string, IntakeOwner>();
const checkpoints = new Map<string, Checkpoint>();
const blocked = new Map<string, { accountId: string; error: ResourceCleanupError }>();
async function identify(location: string) {
  const value = await fs.lstat(location, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return value?.isDirectory() ? { dev: value.dev, ino: value.ino } : null;
}

function destination(accountId: string, source: WorkspaceIntakeSource): string {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  switch (source.kind) {
    case "clone": return `path:${normalize(path.join(source.targetPath, cloneRepositoryName(source.url)))}`;
    case "init": return `path:${normalize(path.join(source.parentPath ?? getBackendRuntime().getPath("desktop"), source.name))}`;
    case "folder": return `folder:${JSON.stringify([accountId, normalize(source.path)])}`;
    case "worktree": return `worktree:${JSON.stringify([accountId, source.projectId])}`;
  }
}

/** A destination is owned for acquisition AND registration. Only acquisition
 * accepts cancellation. Git's settled result decides whether cancellation or
 * completion won; abort alone never confirms success. No intake failure removes
 * an acquired checkout, an existing folder or a completed worktree. */
export async function withWorkspaceIntake<T>(payload: WorkspaceIntakePayload, work: (scope: IntakeScope) => Promise<T>): Promise<T> {
  if (admission !== "open") throw new Error("Workspace intake is shutting down");
  const accountId = payload.accountId, source = { ...payload.source };
  const cloneId = source.kind === "clone" ? source.cloneId : undefined;
  if (cloneId !== undefined && (typeof cloneId !== "string" || !cloneId || cloneId.length > 128)) throw new Error("Invalid clone ID");
  if (source.kind === "clone" && source.attemptId !== undefined &&
    (!cloneId || typeof source.attemptId !== "string" || !source.attemptId || source.attemptId.length > 128)) throw new Error("Invalid clone attempt ID");
  const key = destination(accountId, source);
  const unfinished = blocked.get(key);
  if (unfinished && unfinished.accountId !== accountId) throw new Error("Repository intake cleanup already in progress");
  const sourceKey = source.kind === "clone" ? JSON.stringify([source.url, key]) : "";
  const checkpoint = cloneId ? checkpoints.get(cloneId) : undefined;
  if (checkpoint && (checkpoint.accountId !== accountId || checkpoint.sourceKey !== sourceKey)) throw new Error("Clone ID belongs to another intake");
  if ((cloneId && identities.has(cloneId)) || destinations.has(key)) throw new Error("Repository intake already in progress");
  let settleAcquired!: () => void;
  let finish!: () => void;
  const owner: IntakeOwner = {
    accountId, source, phase: source.kind === "clone" && !checkpoint ? "acquiring" : "importing", controller: new AbortController(),
    acquired: new Promise<void>((resolve) => { settleAcquired = resolve; }), settleAcquired: () => settleAcquired(),
    finished: new Promise<void>((resolve) => { finish = resolve; }), finish: () => finish(),
    workspaceId: checkpoint?.workspaceId ?? randomUUID(),
  };
  owners.add(owner);
  destinations.set(key, owner);
  if (cloneId) identities.set(cloneId, owner);
  const acquireClone = (): Promise<CloneResult> => {
    if (source.kind !== "clone") return Promise.reject(new Error("This intake does not acquire a clone"));
    if (owner.cloning) return owner.cloning;
    owner.cloning = (async () => {
      try {
        if (checkpoint) {
          const current = await identify(checkpoint.result.clonedPath);
          if (!current || current.dev !== checkpoint.identity.dev || current.ino !== checkpoint.identity.ino) {
            throw new Error("Acquired clone directory changed; add the repository from its folder");
          }
          owner.checkpoint = checkpoint;
          owner.outcome = { status: "succeeded" };
          return checkpoint.result;
        }
        const result = await gitService.cloneRepo(source.url, source.targetPath, owner.controller.signal);
        owner.outcome = { status: "succeeded" }; owner.phase = "importing";
        const identity = cloneId ? await identify(result.clonedPath) : null;
        if (identity) owner.checkpoint = { accountId, sourceKey, result, identity, workspaceId: owner.workspaceId };
        return result;
      } catch (error) {
        const canceled = error instanceof Error && error.message === WORKSPACE_CLONE_CANCELED;
        if (owner.outcome?.status !== "succeeded") owner.outcome = canceled ? { status: "canceled" } : { status: "failed", error };
        owner.phase = canceled ? "canceled" : "failed";
        throw error;
      } finally { owner.settleAcquired(); }
    })();
    return owner.cloning;
  };
  const prepareRegistration = async (prepare: () => Promise<CreateWorkspacePayload>): Promise<CreateWorkspacePayload> => {
    if (source.kind === "clone") await acquireClone();
    const saved = owner.checkpoint?.registration;
    if (saved) {
      const current = await identify(saved.input.rootPath);
      if (!current || current.dev !== saved.identity.dev || current.ino !== saved.identity.ino) {
        throw new Error("Prepared workspace directory changed; add the repository from its folder");
      }
      return saved.input;
    }
    const input = await prepare();
    if (owner.checkpoint) {
      const identity = await identify(input.rootPath);
      if (identity) owner.checkpoint.registration = { input, identity };
    }
    return input;
  };
  try {
    if (unfinished) {
      try { await unfinished.error.close(); }
      catch (error) { throw new ResourceCleanupError([error], "Repository intake cleanup failed", unfinished.error.close); }
      if (blocked.get(key) === unfinished) blocked.delete(key);
    }
    if (owner.controller.signal.aborted) throw new Error(WORKSPACE_CLONE_CANCELED);
    const value = await work({ accountId, source, acquireClone, prepareRegistration, workspaceId: owner.workspaceId, resumingRegistration: !!checkpoint }); owner.phase = "succeeded";
    if (cloneId) checkpoints.delete(cloneId);
    return value;
  } catch (error) {
    const canceled = error instanceof Error && error.message === WORKSPACE_CLONE_CANCELED;
    if (!owner.outcome && source.kind === "clone") owner.outcome = canceled ? { status: "canceled" } : { status: "failed", error };
    owner.phase = canceled ? "canceled" : "failed";
    if (error instanceof ResourceCleanupError) blocked.set(key, { accountId, error });
    if (cloneId && owner.checkpoint) checkpoints.set(cloneId, owner.checkpoint);
    throw error;
  } finally {
    if (destinations.get(key) === owner) destinations.delete(key);
    if (cloneId && identities.get(cloneId) === owner) identities.delete(cloneId);
    owner.settleAcquired();
    owners.delete(owner); owner.finish();
  }
}

export function openWorkspaceIntakes(): void {
  if (admission === "open") return;
  if (admission !== "closed" || owners.size || blocked.size) throw new Error("Workspace intake cleanup is still pending");
  admission = "open"; stopping = undefined;
}

/** Fence admission before waiting. Accepted registration drains while the host
 * still owns SQLite; native clone groups abort and cleanup remains retryable. */
export function shutdownWorkspaceIntakes(): Promise<void> {
  if (stopping) return stopping;
  admission = "closing";
  for (const owner of owners) if (owner.phase === "acquiring" || owner.phase === "canceling") owner.controller.abort();
  const pending = Promise.resolve().then(async () => {
    await Promise.all([...owners].map((owner) => owner.finished));
    const results = await Promise.allSettled([...blocked].map(async ([key, value]) => {
      await value.error.close(); if (blocked.get(key) === value) blocked.delete(key);
    }));
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new ResourceCleanupError(errors, "Workspace intake shutdown cleanup failed", shutdownWorkspaceIntakes);
    checkpoints.clear(); admission = "closed";
  });
  stopping = pending;
  void pending.catch(() => { if (stopping === pending) { stopping = undefined; admission = "blocked"; } });
  return pending;
}

export function cloneWorkspaceRepository(accountId: string, source: Extract<WorkspaceIntakeSource, { kind: "clone" }>): Promise<CloneResult> {
  return withWorkspaceIntake({ accountId, source }, (scope) => scope.acquireClone());
}

export async function cancelWorkspaceClone(payload: CancelWorkspaceClonePayload): Promise<boolean> {
  const owner = identities.get(payload.cloneId);
  if (!owner) return false;
  if (owner.accountId !== payload.accountId) throw new Error("Repository clone not found");
  if (owner.source.kind === "clone" && owner.source.attemptId !== payload.attemptId) return false;
  if (owner.phase !== "acquiring" && owner.phase !== "canceling") return false;
  owner.phase = "canceling"; owner.controller.abort();
  await owner.acquired;
  if (owner.outcome?.status === "failed") throw owner.outcome.error;
  return owner.outcome?.status === "canceled";
}
