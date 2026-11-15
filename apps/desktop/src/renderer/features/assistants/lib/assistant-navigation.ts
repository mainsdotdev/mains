export function assistantHref(assistantId: string, runId?: string | null): string {
  const params = new URLSearchParams({ assistant: assistantId });
  if (runId) params.set("run", runId);
  return `/assistants?${params}`;
}
