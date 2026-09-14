import fs from "fs";
import path from "path";
import { app } from "electron";
import type { ModeId } from "../../../shared/modes";
import type { RunExecutionContext } from "../../../shared/adapter.types";

interface WorkspaceExecutionSource {
  id: string;
  rootPath: string;
}

function userDataRoot(): string {
  return app?.getPath("userData") || path.join(process.cwd(), ".data");
}

function assertSafeRunId(runId: string): void {
  if (!runId || runId === "." || runId === ".." || /[\\/]/.test(runId)) {
    throw new Error("Invalid run id for managed working directory");
  }
}

/**
 * Where a workspace-less run of this mode executes. Pure — callers that need
 * the directory to exist create it; callers that only need to resolve a path
 * against it (the file explorer, the renderer's file-open) must not.
 */
export function managedRunDir(runId: string, mode: ModeId): string {
  if (mode === "developer") {
    throw new Error("Developer runs do not have managed working directories");
  }
  assertSafeRunId(runId);
  return path.join(userDataRoot(), "runs", runId, mode);
}

/** Remove the app-owned execution tree for one workspace-less run. */
export function removeManagedRunDir(runId: string, mode: ModeId): void {
  if (mode === "developer") return;
  assertSafeRunId(runId);
  fs.rmSync(path.join(userDataRoot(), "runs", runId), {
    recursive: true,
    force: true,
  });
}

/**
 * The directories mains itself hands to workspace-less runs. Exported so the
 * file explorer can admit them as content roots — a Work run's deliverable is
 * a file the user is meant to open, and it lives here rather than in any
 * workspace. `runs` covers every per-run directory with one entry.
 */
export function managedExecutionRoots(): string[] {
  return [path.join(userDataRoot(), "runs")];
}

/**
 * Resolve the explicit cwd handed to every provider adapter.
 *
 * Developer runs keep their real Workspace path.
 * Work and Chat runs each get a durable per-run directory.
 */
export function resolveRunExecution(args: {
  runId: string;
  mode: ModeId;
  workspace?: WorkspaceExecutionSource | null;
}): RunExecutionContext {
  if (args.workspace) {
    return {
      cwd: args.workspace.rootPath,
      workspaceId: args.workspace.id,
    };
  }
  if (args.mode === "developer") {
    throw new Error("Developer runs require a workspace");
  }

  const cwd = managedRunDir(args.runId, args.mode);
  fs.mkdirSync(cwd, { recursive: true });
  return { cwd, workspaceId: null };
}
