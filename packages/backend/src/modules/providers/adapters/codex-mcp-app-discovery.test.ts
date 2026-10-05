import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexCapabilities } from "./codex-capabilities";
import { createCodexMcpApps } from "./codex-mcp-apps";
import type { CodexAppServer } from "./codex-app-server.client";

function fixture(marketplacePath: string | null = null, iconUrls: { composerIconUrl?: string; logoUrl?: string; logoUrlDark?: string } = {}) {
  const plugin = { id: "canvas@remote", name: "canvas", remotePluginId: "remote-canvas",
    installed: true, enabled: true, source: { type: "remote" },
    interface: { displayName: "Canvas", composerIconUrl: "https://example.com/canvas.svg", ...iconUrls },
  };
  let owner = "canvas-connector";
  const sendRequest = vi.fn(async (method: string, params?: any, _timeoutMs?: number) => {
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
  afterEach(() => vi.useRealTimers());

  it("shares concurrent inventory requests and discards a failed request before retrying", async () => {
    const { capabilities, sendRequest } = fixture();
    const original = sendRequest.getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    sendRequest.mockImplementation(async (method, params) => {
      if (method === "mcpServerStatus/list") await pending;
      return original(method, params);
    });
    const requests = [capabilities.readMcpInventory(), capabilities.readMcpInventory()];
    await vi.waitFor(() => expect(sendRequest.mock.calls.filter(([method]) => method === "mcpServerStatus/list")).toHaveLength(1));
    release();
    const [first, second] = await Promise.all(requests);
    expect(first).toBe(second);
    sendRequest.mockRejectedValueOnce(new Error("MCP startup failed"));
    await expect(capabilities.readMcpInventory()).rejects.toThrow("MCP startup failed");
    await expect(capabilities.readMcpInventory()).resolves.toEqual(first);
  });

  it("allows cold MCP discovery to finish after the ordinary 30 second RPC budget", async () => {
    vi.useFakeTimers();
    const { capabilities, sendRequest } = fixture();
    const original = sendRequest.getMockImplementation()!;
    sendRequest.mockImplementation((method: string, params: any, timeoutMs = 30_000) => {
      if (method !== "mcpServerStatus/list") return original(method, params);
      return new Promise<Awaited<ReturnType<typeof original>>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`)), timeoutMs);
        setTimeout(() => { clearTimeout(timer); resolve(original(method, params)); }, 35_000);
      });
    });
    const result = capabilities.listMcpAppEntrypoints().then((entries) => ({ entries }), (error: unknown) => ({ error }));
    await vi.advanceTimersByTimeAsync(35_001);
    expect(await result).toMatchObject({ entries: [expect.objectContaining({ name: "Canvas" })] });
  });

  it("opens an installed extension with one fresh inventory instead of rediscovering it", async () => {
    const { capabilities, sendRequest } = fixture();
    const [entry] = await capabilities.listMcpAppEntrypoints();
    const original = sendRequest.getMockImplementation()!;
    sendRequest.mockImplementation(async (method, params) => {
      if (method === "thread/start") return { thread: { id: "app-thread" } } as any;
      if (method === "mcpServer/resource/read") return { contents: [] } as any;
      if (method === "mcpServer/tool/call") return { content: [] } as any;
      return original(method, params);
    });
    sendRequest.mockClear();
    const apps = createCodexMcpApps({ ensureServer: async () => ({ sendRequest }) as unknown as CodexAppServer,
      readInventory: capabilities.readMcpInventory, listEntrypoints: capabilities.listMcpAppEntrypoints,
    });
    await apps.open(entry.id);
    expect(sendRequest.mock.calls.filter(([method]) => method === "mcpServerStatus/list")).toHaveLength(1);
  });
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

  it("carries remote SVG logo variants through installed-plugin discovery", async () => {
    const { capabilities } = fixture(null, { composerIconUrl: "https://example.com/composer.png",
      logoUrl: "https://example.com/light.svg", logoUrlDark: "https://example.com/dark.svg" });
    expect(await capabilities.listMcpAppEntrypoints()).toMatchObject([{
      icons: [{ src: "https://example.com/composer.png" },
        { src: "https://example.com/light.svg", theme: "light" },
        { src: "https://example.com/dark.svg", theme: "dark" }],
    }]);
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
