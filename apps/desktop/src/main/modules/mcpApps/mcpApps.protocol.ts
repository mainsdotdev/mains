import { protocol } from "electron";
import { mcpAppsRegistry } from "./mcpApps.registry";

function tokenFromRequestUrl(rawUrl: string): string | null {
  const url = new URL(rawUrl);
  if (url.host !== "resource") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[1] !== "index.html") return null;
  return /^[0-9a-f-]{36}$/i.test(parts[0]) ? parts[0] : null;
}

/** Register the in-memory MCP App document protocol after Electron is ready. */
export function registerMcpAppsProtocolHandler(): void {
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
    protocol.unhandle("mains-mcp-app");
  } catch {
    // Electron may already have torn the session down during shutdown.
  }
}
