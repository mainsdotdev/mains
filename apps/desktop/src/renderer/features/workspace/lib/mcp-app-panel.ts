import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import type { UiContextParts } from "./ui-context";

export type McpAppScope = UiContextParts;

export function sameMcpApp(left: Pick<McpAppEntrypoint, "server" | "resourceUri" | "connectorId" | "linkId">,
  right: Pick<McpAppEntrypoint, "server" | "resourceUri" | "connectorId" | "linkId">): boolean {
  return left.server === right.server && left.resourceUri === right.resourceUri &&
    left.connectorId === right.connectorId && (left.linkId ?? null) === (right.linkId ?? null);
}

export function sameMcpAppScope(left: McpAppScope, right: McpAppScope): boolean {
  return left.backendId === right.backendId && left.spaceId === right.spaceId &&
    left.providerId === right.providerId && left.mode === right.mode &&
    (left.workspaceId ?? null) === (right.workspaceId ?? null) &&
    (left.collectionId ?? null) === (right.collectionId ?? null);
}

/** UI tools use bare names; codex_apps publishes the connector's qualified names. */
export function mcpAppToolName(server: string, entrypointTool: string, requestedTool: string): string {
  const separator = entrypointTool.lastIndexOf(".");
  return server === "codex_apps" && separator >= 0 && !requestedTool.includes(".")
    ? `${entrypointTool.slice(0, separator + 1)}${requestedTool}` : requestedTool;
}

export function mcpAppConversationPath(scope: McpAppScope, runId?: string): string {
  if (scope.mode === "developer" && scope.workspaceId) return `/code/${scope.workspaceId}`;
  return runId ? `/code/runs/${runId}` : "/code";
}
