import type { CancelWorkspaceClonePayload, WorkspaceIntakeSource } from "@mains/contracts/workspace-intake";
import { gitService } from "../git";

const activeClones = new Map<string, {
  accountId: string;
  controller: AbortController;
  settled: Promise<void>;
}>();

/** Track only acquisition: once the clone has finished, workspace intake completes normally. */
export async function cloneWorkspaceRepository(
  accountId: string,
  source: Extract<WorkspaceIntakeSource, { kind: "clone" }>,
) {
  if (!source.cloneId) return gitService.cloneRepo(source.url, source.targetPath);
  if (typeof source.cloneId !== "string" || source.cloneId.length > 128) throw new Error("Invalid clone ID");
  if (activeClones.has(source.cloneId)) throw new Error("Repository clone already in progress");
  const controller = new AbortController();
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  activeClones.set(source.cloneId, { accountId, controller, settled });
  try {
    return await gitService.cloneRepo(source.url, source.targetPath, controller.signal);
  } finally {
    activeClones.delete(source.cloneId);
    settle();
  }
}

/** Wait for process termination and cleanup before acknowledging cancellation. */
export async function cancelWorkspaceClone(payload: CancelWorkspaceClonePayload): Promise<boolean> {
  const clone = activeClones.get(payload.cloneId);
  if (!clone) return false;
  if (clone.accountId !== payload.accountId) throw new Error("Repository clone not found");
  clone.controller.abort();
  await clone.settled;
  return true;
}
