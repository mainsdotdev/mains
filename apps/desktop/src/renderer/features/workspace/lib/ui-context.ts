import { isRunTab } from "./repo-utils";

interface UiContextParts {
  backendId: string | null;
  spaceId: string;
  providerId: string;
  mode: string;
  workspaceId?: string;
  collectionId?: string | null;
}

/** Local UI state belongs to the backend as well as the visible space. */
export function workspaceViewKey(parts: UiContextParts): string {
  return JSON.stringify([
    parts.backendId ?? "local",
    parts.spaceId,
    parts.providerId,
    parts.mode,
    parts.workspaceId ?? null,
  ]);
}

/** A pre-run draft gets a stable owner; its browser tabs move to the run on send. */
export function composerOwnerKey(
  parts: UiContextParts,
  runId: string | null,
): string {
  const backend = parts.backendId ?? "local";
  if (runId && isRunTab(runId)) return JSON.stringify([backend, "run", runId]);
  return JSON.stringify([
    backend,
    "draft",
    parts.spaceId,
    parts.providerId,
    parts.mode,
    parts.workspaceId ?? null,
    parts.collectionId ?? null,
  ]);
}
