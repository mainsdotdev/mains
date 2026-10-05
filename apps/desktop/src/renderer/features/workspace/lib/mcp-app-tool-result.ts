import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import type { RunEvent } from "../types";

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return undefined; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Route new model tool results to the open app, preserving connector/account ownership. */
export function latestMcpAppToolResult(events: readonly RunEvent[], app: McpAppEntrypoint, sinceMs: number): {
  input: Record<string, unknown>; output: Record<string, unknown>;
} | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type !== "tool_call" || !event.metadata || event.timestamp.getTime() < sinceMs ||
        !["done", "completed"].includes(String(event.metadata?.status))) continue;
    const context = record(event.metadata.mcpApp);
    if (!context || context.server !== app.server || context.resourceUri !== app.resourceUri ||
        context.connectorId !== app.connectorId || (context.linkId ?? null) !== (app.linkId ?? null)) continue;
    const output = record(event.metadata.output);
    if (!output || output.isError === true) continue;
    return { input: record(event.metadata.input) ?? {}, output };
  }
  return undefined;
}
