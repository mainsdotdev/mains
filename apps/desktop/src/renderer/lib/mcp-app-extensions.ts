import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";

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

/** Vendor compatibility does not decide which plugins appear in navigation. */
export function mcpAppCompatibility(entry: McpAppEntrypoint | undefined): {
  unsupportedTools?: Readonly<Record<string, string>>;
  notice?: string;
  webUrl?: string;
} {
  if (!entry?.tool.startsWith("tldraw.")) return {};
  return {
    unsupportedTools: {
      _dotcom_zero: "tldraw live sync does not support the Mains app origin. Use MCP file listing instead.",
    },
    notice: "Extension preview: tldraw currently blocks live editing from Mains (403). Its server needs to allow the Mains app origin.",
    webUrl: "https://www.tldraw.com/",
  };
}
