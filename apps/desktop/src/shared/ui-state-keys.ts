/** UI owners include the backend so local and remote records cannot collide. */
export function runOwnerKey(backendId: string | null, runId: string): string {
  return JSON.stringify([backendId ?? "local", "run", runId]);
}

/** New conversations inherit preferences only from the same backend and provider. */
export function providerSettingsKey(backendId: string | null, providerId: string): string {
  return JSON.stringify([backendId ?? "local", providerId]);
}

/** Code preview tabs and their expansion are shared by chats in one workspace. */
export function workspaceBrowserExpansionKey(backendId: string | null, workspaceId: string): string {
  return JSON.stringify([backendId ?? "local", "browser-workspace", workspaceId]);
}

/** Code preview tabs share the existing backend/workspace browser owner. */
export function workspaceIdFromPreviewOwnerKey(key: string, backendId: string): string | null {
  const parts = keyParts(key);
  return parts?.length === 3 && parts[0] === backendId && parts[1] === "browser-workspace" && typeof parts[2] === "string"
    ? parts[2] : null;
}

/** Reviewed patches are shared by conversations and spaces in one workspace. */
export function workspaceReviewKey(backendId: string | null, workspaceId: string): string {
  return JSON.stringify([backendId ?? "local", "review-workspace", workspaceId]);
}

function keyParts(key: string): unknown[] | null {
  try {
    const parts: unknown = JSON.parse(key);
    return Array.isArray(parts) ? parts : null;
  } catch {
    return null;
  }
}

export function isRunOwnerKey(key: string, backendId: string, runId: string): boolean {
  const parts = keyParts(key);
  return parts?.length === 3 && parts[0] === backendId && parts[1] === "run" && parts[2] === runId;
}

export function runIdFromOwnerKey(key: string, backendId: string): string | null {
  const parts = keyParts(key);
  return parts?.length === 3 && parts[0] === backendId && parts[1] === "run" && typeof parts[2] === "string"
    ? parts[2]
    : null;
}

export function isWorkspaceDraftOwnerKey(key: string, backendId: string, workspaceId: string): boolean {
  const parts = keyParts(key);
  return parts?.length === 7 && parts[0] === backendId && parts[1] === "draft" && parts[5] === workspaceId;
}

export function workspaceIdFromDraftOwnerKey(key: string, backendId: string): string | null {
  const parts = keyParts(key);
  return parts?.length === 7 && parts[0] === backendId && parts[1] === "draft" && typeof parts[5] === "string"
    ? parts[5]
    : null;
}

export function isWorkspaceViewKey(key: string, backendId: string, workspaceId: string): boolean {
  const parts = keyParts(key);
  return parts?.length === 5 && parts[0] === backendId && parts[4] === workspaceId;
}

export function workspaceIdFromViewKey(key: string, backendId: string): string | null {
  const parts = keyParts(key);
  return parts?.length === 5 && parts[0] === backendId && typeof parts[4] === "string"
    ? parts[4]
    : null;
}

export function viewKeyBelongsToBackend(key: string, backendId: string): boolean {
  const parts = keyParts(key);
  return parts?.length === 5 && parts[0] === backendId;
}
