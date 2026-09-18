import type { McpAppResourceMeta } from "./mcpApps.document";

export interface ReadMcpAppResourcePayload {
  runId: string;
  server: string;
  resourceUri: string;
  originCallId?: string;
  connectorId?: string;
}

export interface ReadMcpAppResourceResponse {
  url: string;
  mimeType: string;
  meta: McpAppResourceMeta;
}

export interface CallMcpAppToolPayload {
  runId: string;
  server: string;
  tool: string;
  arguments?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface SendMcpAppMessagePayload {
  runId: string;
  content: unknown;
  modelContext?: {
    content?: unknown;
    structuredContent?: unknown;
  };
}

export interface SendMcpAppMessageResponse {
  runId: string;
}
