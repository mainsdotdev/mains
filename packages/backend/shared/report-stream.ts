/** Live assistant prose that can become a transcript message when interrupted. */
export function isAssistantReportStream(event: {
  kind: string;
  metadata?: Record<string, unknown>;
}): boolean {
  if (event.kind !== "report" || event.metadata?.voice === true || event.metadata?.isFromSubagent === true) return false;
  const source = event.metadata?.source;
  return source === undefined || source === "agent_message_streaming" || source === "assistant.message_delta";
}
