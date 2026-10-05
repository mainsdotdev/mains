/** A plugin-provided UI that the host can open without an agent turn. */
export interface McpAppIcon {
  src: string;
  mimeType?: string;
  theme?: "light" | "dark";
}

export interface McpAppEntrypoint {
  id: string;
  name: string;
  server: string;
  tool: string;
  resourceUri: string;
  pluginId?: string;
  icons?: McpAppIcon[];
  connectorId?: string;
  linkId?: string | null;
  entrypoints: Array<"global" | "thread">;
  preferredModelDisplayMode: "inline" | "fullscreen";
}

/** The completed tool call that owns an app resource and its UI result. */
export interface McpAppToolMetadata {
  server: string;
  tool: string;
  resourceUri: string;
  originCallId?: string;
  connectorId?: string;
  linkId?: string | null;
  appName?: string;
  actionName?: string;
  preferredModelDisplayMode?: "inline" | "fullscreen";
}

export interface McpAppToolOpen {
  runId: string;
  app: McpAppToolMetadata;
  input?: Record<string, unknown> | null;
  output: unknown;
  title: string;
}

export interface OpenMcpAppExtensionPayload {
  providerId: string;
  entrypointId: string;
}

export interface OpenMcpAppExtensionResponse {
  sessionId: string;
  app: McpAppEntrypoint;
  output: unknown;
}
