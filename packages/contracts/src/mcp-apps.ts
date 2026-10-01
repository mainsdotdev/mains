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

export interface OpenMcpAppExtensionPayload {
  providerId: string;
  entrypointId: string;
}

export interface OpenMcpAppExtensionResponse {
  sessionId: string;
  app: McpAppEntrypoint;
  output: unknown;
}
