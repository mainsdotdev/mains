import { app, protocol, session } from "electron";
import { mcpAppsRegistry } from "./mcpApps.registry";
import { mcpAppBrowserHeaders } from "./mcpApps.requestHeaders";

function tokenFromRequestUrl(rawUrl: string): string | null {
  const url = new URL(rawUrl);
  if (url.pathname !== "/index.html" || url.port || url.username || url.password) return null;
  return /^[0-9a-f-]{36}$/i.test(url.hostname) ? url.hostname : null;
}

/** Register the in-memory MCP App document protocol after Electron is ready. */
export function registerMcpAppsProtocolHandler(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let isApp = false;
    try {
      const source = new URL(details.frame?.url ?? "");
      isApp = source.protocol === "mains-mcp-app:" && /^[0-9a-f-]{36}$/i.test(source.hostname);
    } catch { /* Other renderer requests keep their original headers. */ }
    callback({ requestHeaders: isApp
      ? mcpAppBrowserHeaders(details.requestHeaders, app.getName())
      : details.requestHeaders });
  });
  protocol.handle("mains-mcp-app", (request) => {
    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }

    let token: string | null = null;
    try {
      token = tokenFromRequestUrl(request.url);
    } catch {
      // Invalid custom-protocol URL.
    }
    if (!token) return new Response("Not found", { status: 404 });

    const document = mcpAppsRegistry.get(token);
    if (!document) return new Response("Resource expired", { status: 410 });

    return new Response(document.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": document.csp,
        "Permissions-Policy": document.permissionsPolicy,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
}

export function unregisterMcpAppsProtocolHandler(): void {
  mcpAppsRegistry.clear();
  try {
    session.defaultSession.webRequest.onBeforeSendHeaders(null);
    protocol.unhandle("mains-mcp-app");
  } catch {
    // Electron may already have torn the session down during shutdown.
  }
}
