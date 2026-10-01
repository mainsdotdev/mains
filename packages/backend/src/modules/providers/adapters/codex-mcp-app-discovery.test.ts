import { describe, expect, it, vi } from "vitest";
import { createCodexCapabilities } from "./codex-capabilities";
import type { CodexAppServer } from "./codex-app-server.client";

function fixture(marketplacePath: string | null = null) {
  const plugin = { id: "canvas@remote", name: "canvas", remotePluginId: "remote-canvas",
    installed: true, enabled: true, source: { type: "remote" },
    interface: { displayName: "Canvas", composerIconUrl: "https://example.com/canvas.svg" },
  };
  let owner = "canvas-connector";
  const sendRequest = vi.fn(async (method: string, params?: any) => {
    if (method === "experimentalFeature/list") return { data: [{ name: "plugins", enabled: true, stage: "beta" }], nextCursor: null };
    if (method === "mcpServerStatus/list") return { data: [{ name: "codex_apps", pluginId: null, tools: {
      canvas: { name: "canvas.home", title: "Canvas", _meta: {
        connector_id: "canvas-connector", connector_name: "Canvas", link_id: "account-1",
        ui: { resourceUri: "ui://canvas/home" }, "openai/ui": { entrypoints: [{ type: "global" }] },
      } },
    } }], nextCursor: null };
    if (method === "plugin/installed") return { marketplaces: [{ name: "remote", path: marketplacePath, plugins: [plugin] }] };
    if (method === "plugin/read") return { plugin: { summary: plugin, apps: [{ id: owner }], mcpServers: [], skills: [] } };
    if (method === "config/value/write") { plugin.enabled = params.value; return {}; }
    throw new Error(`Unexpected RPC: ${method}`);
  });
  const server = { sendRequest } as unknown as CodexAppServer;
  const capabilities = createCodexCapabilities({ ensureServer: async () => server, getRunningServer: () => server,
    getCliHealth: async () => ({ version: "0.153.0", channel: null, outdated: false, compatibility: "supported" }),
  });
  return { plugin, sendRequest, capabilities, setOwner: (id: string) => { owner = id; } };
}

describe("installed MCP App discovery", () => {
  it("verifies connector ownership, caches metadata, and reads current install state on every refresh", async () => {
    const { capabilities, sendRequest, plugin } = fixture();
    expect(await capabilities.listMcpAppEntrypoints()).toMatchObject([{
      pluginId: "canvas@remote", connectorId: "canvas-connector", name: "Canvas",
      icons: [{ src: "https://example.com/canvas.svg" }],
    }]);
    await capabilities.listMcpAppEntrypoints();
    expect(sendRequest.mock.calls.filter(([method]) => method === "plugin/read")).toHaveLength(1);
    expect(sendRequest.mock.calls.filter(([method]) => method === "plugin/installed")).toHaveLength(2);
    plugin.installed = false;
    expect(await capabilities.listMcpAppEntrypoints()).toEqual([]);
  });

  it("does not treat a matching display name as ownership", async () => {
    const { capabilities, setOwner } = fixture();
    setOwner("other-connector");
    expect(await capabilities.listMcpAppEntrypoints()).toEqual([]);
  });

  it("rediscovers ownership after enablement changes and finds plugins with unrelated display names", async () => {
    const { capabilities, sendRequest, plugin } = fixture("/tmp/local-marketplace");
    plugin.interface.displayName = "Design toolkit";
    expect(await capabilities.listMcpAppEntrypoints()).toHaveLength(1);
    await capabilities.setPluginEnabled(plugin.id, false);
    expect(await capabilities.listMcpAppEntrypoints()).toEqual([]);
    await capabilities.setPluginEnabled(plugin.id, true);
    expect(await capabilities.listMcpAppEntrypoints()).toHaveLength(1);
    expect(sendRequest.mock.calls.filter(([method]) => method === "plugin/read")).toHaveLength(2);
  });
});
