import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCodexMcpApps, discoverMcpAppEntrypoints, installedMcpAppEntrypoints } from "./codex-mcp-apps";
import type { PluginInfo } from "../../../../shared/adapter.types";
import type { CodexAppServer } from "./codex-app-server.client";
import type { McpServerStatus } from "./codex-app-server-protocol/generated/v2/McpServerStatus";

function tool(name: string, meta: Record<string, unknown> = {}) {
  return {
    name, inputSchema: { type: "object" },
    _meta: { connector_id: "tldraw", connector_name: "tldraw", link_id: "account-1", ...meta },
  };
}

const inventory = [{
  name: "codex_apps",
  tools: {
    home: tool("tldraw.tldraw_home", {
      ui: { resourceUri: "ui://tldraw/app.html", visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }, { type: "file" }] },
    }),
    boards: tool("tldraw._dotcom_boards", { ui: { visibility: ["app"] } }),
    modelOnly: tool("tldraw.exec", { ui: { visibility: ["model"] } }),
    otherAccount: tool("tldraw.private", { link_id: "account-2" }),
    otherApp: tool("figma.read", { connector_id: "figma" }),
  },
}] as unknown as McpServerStatus[];

describe("Codex app extension sessions", () => {
  const sendRequest = vi.fn();
  const server = { sendRequest } as unknown as CodexAppServer;
  const readInventory = vi.fn();
  let threads = 0;

  beforeEach(() => {
    vi.resetAllMocks();
    threads = 0;
    readInventory.mockResolvedValue(inventory);
    sendRequest.mockImplementation(async (method: string) => {
      if (method === "thread/start") return { thread: { id: `thread-${++threads}` } };
      if (method === "mcpServer/resource/read") return {
        contents: [{ uri: "ui://tldraw/app.html", mimeType: "text/html;profile=mcp-app", text: "<main>tldraw</main>" }],
        originCallId: null,
      };
      if (method === "mcpServer/tool/call") return { content: [], structuredContent: { boards: [] } };
      return {};
    });
  });

  function host() {
    return createCodexMcpApps({ ensureServer: async () => server, readInventory });
  }

  it("discovers only explicitly declared app entrypoints", () => {
    const apps = discoverMcpAppEntrypoints(inventory);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      name: "tldraw", server: "codex_apps", tool: "tldraw.tldraw_home",
      resourceUri: "ui://tldraw/app.html", connectorId: "tldraw", linkId: "account-1",
      entrypoints: ["global", "thread"],
    });
  });

  it("requires installed, enabled plugin ownership and preserves tool icons and titles", () => {
    const source = {
      plugin: { id: "plugin@marketplace", installed: true, enabled: true,
        interface: { composerIcon: "https://example.com/plugin.svg" } } as PluginInfo,
      connectorIds: ["tldraw"], mcpServers: [],
    };
    const entries = discoverMcpAppEntrypoints(inventory);
    expect(installedMcpAppEntrypoints(entries, [source])[0]).toMatchObject({
      pluginId: "plugin@marketplace", icons: [{ src: "https://example.com/plugin.svg" }],
    });
    expect(installedMcpAppEntrypoints(entries, [{ ...source, connectorIds: ["unrelated"] }])).toEqual([]);
    for (const flags of [{ installed: false }, { enabled: false }]) {
      expect(installedMcpAppEntrypoints(entries, [{ ...source, plugin: { ...source.plugin, ...flags } }])).toEqual([]);
    }
    const status = { ...inventory[0], pluginId: "plugin@marketplace", tools: {
      home: { ...inventory[0].tools.home!, title: "Boards", icons: [{ src: "https://example.com/tool.svg", theme: "dark" }] },
    } } as unknown as McpServerStatus;
    expect(installedMcpAppEntrypoints(discoverMcpAppEntrypoints([status]), [{ ...source, connectorIds: [] }])[0]).toMatchObject({
      name: "Boards", icons: [{ src: "https://example.com/tool.svg", theme: "dark" }],
    });
  });

  it("opens isolated MCP threads without starting model turns and maps bare UI tool names", async () => {
    const apps = host();
    const entry = discoverMcpAppEntrypoints(inventory)[0];
    const first = await apps.open(entry.id);
    const second = await apps.open(entry.id);
    expect(first.id).not.toBe(second.id);
    await apps.callTool(first.id, "_dotcom_boards", { limit: 10 });
    expect(sendRequest).toHaveBeenLastCalledWith("mcpServer/tool/call", {
      threadId: "thread-1", server: "codex_apps", tool: "tldraw._dotcom_boards",
      arguments: { limit: 10 }, _meta: undefined,
    }, 60_000);
    expect(sendRequest).toHaveBeenCalledWith("mcpServer/resource/read", expect.objectContaining({
      connectorId: "tldraw", target: { connectorId: "tldraw", linkId: "account-1" },
    }));
    expect(sendRequest.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    await apps.close(first.id);
    await expect(apps.callTool(first.id, "_dotcom_boards")).rejects.toThrow("expired");
    await apps.callTool(second.id, "tldraw._dotcom_boards");
    expect(sendRequest.mock.calls.at(-1)?.[1]).toMatchObject({ threadId: "thread-2" });
  });

  it("rejects another connector, account, or model-only tool before sending an RPC", async () => {
    const apps = host();
    const session = await apps.open(discoverMcpAppEntrypoints(inventory)[0].id);
    sendRequest.mockClear();
    for (const name of ["figma.read", "private", "exec", "unknown"]) {
      await expect(apps.callTool(session.id, name)).rejects.toThrow("not available");
    }
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("rechecks installed entrypoints before opening a retained runtime tool", async () => {
    const apps = createCodexMcpApps({ ensureServer: async () => server, readInventory,
      listEntrypoints: async () => [],
    });
    await expect(apps.open(discoverMcpAppEntrypoints(inventory)[0].id)).rejects.toThrow("no longer available");
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("releases a thread when bootstrap fails and invalidates sessions on server shutdown", async () => {
    const apps = host();
    const entry = discoverMcpAppEntrypoints(inventory)[0];
    sendRequest.mockImplementationOnce(async () => ({ thread: { id: "failed-thread" } }))
      .mockImplementationOnce(async () => { throw new Error("resource unavailable"); });
    await expect(apps.open(entry.id)).rejects.toThrow("resource unavailable");
    expect(sendRequest).toHaveBeenLastCalledWith("thread/unsubscribe", { threadId: "failed-thread" });
    const session = await apps.open(entry.id);
    apps.clear();
    await expect(apps.callTool(session.id, "_dotcom_boards")).rejects.toThrow("expired");
  });
});
