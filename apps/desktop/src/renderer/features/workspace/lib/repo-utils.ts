
export function normalizeRepoUrl(repoUrl: string | null | undefined): string | null {
  if (!repoUrl) return null;

  // SSH format: git@github.com:owner/repo.git
  const sshMatch = repoUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS format: https://github.com/owner/repo(.git)?
  const httpsMatch = repoUrl.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

/** Check if an activeTab ID represents an issue tab. */
export function isIssueTab(tabId: string): boolean {
  return tabId.startsWith("issue:");
}

/** Extract the entityId from an issue tab ID. */
export function getIssueEntityId(tabId: string): string {
  return tabId.slice(6);
}

/** Build a stable tab ID for an issue entity. */
export function makeIssueTabId(entityId: string): string {
  return `issue:${entityId}`;
}

/** Check if an activeTab ID represents the new-run draft tab. */
export function isNewRunTab(tabId: string): boolean {
  return tabId === "new-run";
}

/** Check if an activeTab ID represents a signal tab. */
export function isSignalTab(tabId: string): boolean {
  return tabId.startsWith("signal:");
}

/** Extract the entityId from a signal tab ID. */
export function getSignalEntityId(tabId: string): string {
  return tabId.slice(7);
}

/** Check if an activeTab ID represents a run tab (not editor, issue, signal, note, or new-run). */
export function isRunTab(tabId: string): boolean {
  return tabId !== "editor" && !isIssueTab(tabId) && !isSignalTab(tabId) && !isNoteTab(tabId) && !isNewRunTab(tabId);
}

/** Check if an activeTab ID represents a note tab. */
export function isNoteTab(tabId: string): boolean {
  return tabId.startsWith("note:");
}

/** Extract the noteId from a note tab ID. */
export function getNoteId(tabId: string): string {
  return tabId.slice(5);
}

/** Build a stable tab ID for a note. */
export function makeNoteTabId(noteId: string): string {
  return `note:${noteId}`;
}
