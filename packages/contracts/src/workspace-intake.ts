/** Acquiring a repository and importing it into a Developer Project/Workspace. */
export type WorkspaceIntakeSource =
  | { kind: "folder"; path: string }
  | { kind: "clone"; url: string; targetPath: string; cloneId?: string }
  | { kind: "init"; name: string; parentPath?: string }
  | { kind: "worktree"; projectId: string };

export interface WorkspaceIntakePayload {
  accountId: string;
  source: WorkspaceIntakeSource;
}

export interface CancelWorkspaceClonePayload {
  accountId: string;
  cloneId: string;
}

export const WORKSPACE_CLONE_CANCELED = "Repository clone canceled";

/** The same repository name is used for the clone directory and its pending row. */
export function cloneRepositoryName(url: string): string {
  const name = url.replace(/[?#].*$/, "").replace(/\/+$/, "").split(/[/:]/).pop()?.replace(/\.git$/i, "");
  return !name || name === "." || name === ".." ? "repo" : name;
}
