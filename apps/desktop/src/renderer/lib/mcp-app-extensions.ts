import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";

export const MAX_PINNED_MCP_APPS = 5;

/** A rail preference identifies an app, never an authenticated connection. */
export function mcpAppPinKey(entry: McpAppEntrypoint): string {
  const owner = entry.pluginId ? ["plugin", entry.pluginId]
    : entry.connectorId ? ["connector", entry.connectorId] : ["server", entry.server];
  return JSON.stringify(["mcp-app-pin", 1, ...owner, entry.tool]);
}

/** Resolve old connection ids only from live ownership metadata; retain missing pins. */
export function normalizeMcpAppPins(keys: string[], entries: McpAppEntrypoint[]): string[] {
  return [...new Set(keys.map((key) => {
    const exact = entries.find((entry) => entry.id === key);
    if (exact) return mcpAppPinKey(exact);
    try {
      const legacy: unknown = JSON.parse(key);
      if (!Array.isArray(legacy) || legacy.length !== 4 ||
        typeof legacy[0] !== "string" || typeof legacy[1] !== "string" ||
        !(legacy[2] === null || typeof legacy[2] === "string") ||
        !(legacy[3] === null || typeof legacy[3] === "string")) return key;
      const [server, tool, connector] = legacy;
      const matches = entries.filter((entry) => entry.tool === tool && (connector
        ? entry.connectorId === connector : !entry.connectorId && entry.server === server));
      const candidates = new Set(matches.map(mcpAppPinKey));
      return candidates.size === 1 ? [...candidates][0] : key;
    } catch { return key; }
  }))];
}

export function mcpAppPath(entry: Pick<McpAppEntrypoint, "id">): string {
  // Keep opaque account ids out of React Router's percent/slash decoding.
  const token = btoa(String.fromCharCode(...new TextEncoder().encode(entry.id)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `/apps/${token}`;
}

export function mcpAppId(token: string | undefined): string | undefined {
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) return undefined;
  try {
    const bytes = Uint8Array.from(atob(token.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

const UNSUPPORTED_APP_INTERFACE_NOTICE = "This app's interface is currently not supported in Mains. You can continue using the plugin in chat.";

/** Known UI limitations do not disable plugin tools or app discovery. */
export function mcpAppCompatibility(entry: McpAppEntrypoint | undefined): {
  unsupportedTools?: Readonly<Record<string, string>>;
  notice?: string;
  webUrl?: string;
} {
  if (entry?.tool.startsWith("figma.")) return { notice: UNSUPPORTED_APP_INTERFACE_NOTICE };
  if (!entry?.tool.startsWith("tldraw.")) return {};
  return {
    unsupportedTools: {
      _dotcom_zero: "tldraw live sync does not support the Mains app origin. Use MCP file listing instead.",
    },
    notice: UNSUPPORTED_APP_INTERFACE_NOTICE,
    webUrl: "https://www.tldraw.com/",
  };
}
