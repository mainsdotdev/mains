export function assistantHref(assistantId: string, runId?: string | null): string {
  const params = new URLSearchParams({ assistant: assistantId });
  if (runId) params.set("run", runId);
  return `/assistants?${params}`;
}

export function assistantTeamGroupKey(backendId: string | null, accountId: string, teamId: string | null): string {
  return JSON.stringify([backendId ?? "local", accountId, "mate-team", teamId]);
}
