import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import type { RunEvent } from "../types";
import { mcpStructuredContentOmitted } from "./mcp-output";

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return undefined; }
  }
  return plainRecord(value);
}

/**
 * An app resource is tied to a completed, successful originating tool call.
 * Connectors report failures in-band (`structuredContent.error_code`) without
 * setting `isError`, and the app-server refuses to serve the resource of a call
 * that did not succeed.
 */
export function hasUsableMcpAppResult(output: unknown): boolean {
  // Older Claude transcripts store text-only tools as their MCP content blocks.
  if (Array.isArray(output)) return output.length > 0;
  const result = plainRecord(output);
  if (!result || result.isError === true || mcpStructuredContentOmitted(output))
    return false;

  const structured = plainRecord(result.structuredContent);
  if (typeof structured?.error_code === "string") return false;

  const meta = plainRecord(result._meta);
  const codexApps = plainRecord(meta?._codex_apps);
  const authFailure = plainRecord(codexApps?.connector_auth_failure);
  return authFailure?.is_auth_failure !== true;
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
