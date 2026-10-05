import { configureStore } from "@reduxjs/toolkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { CHANNELS } from "@mains/contracts/channels";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ invoke: mocks.invoke }) }));
import { baseApi } from "./baseApi";
import { mcpAppsApi } from "./mcpAppsApi";
import { providersApi } from "./providersApi";

afterEach(() => vi.resetAllMocks());

describe("MCP App inventory cache", () => {
  it("refreshes a subscribed rail inventory after plugin install, enablement, update and removal", async () => {
    let entries: McpAppEntrypoint[] = [];
    mocks.invoke.mockImplementation(async (handler) => ({ success: true,
      data: handler === CHANNELS.mcpApps.listEntrypoints ? entries : undefined,
    }));
    const store = configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer },
      middleware: (getDefault) => getDefault().concat(baseApi.middleware),
    });
    const query = store.dispatch(mcpAppsApi.endpoints.getMcpAppEntrypoints.initiate("codex"));
    try {
      await query.unwrap();
      const app: McpAppEntrypoint = { id: "canvas:account-1", name: "Canvas", tool: "canvas.home", server: "codex_apps",
        resourceUri: "ui://canvas/home", entrypoints: ["global"], preferredModelDisplayMode: "fullscreen" };
      entries = [app];
      await store.dispatch(providersApi.endpoints.installProviderPlugin.initiate({ providerId: "codex", pluginId: "canvas" })).unwrap();
      await vi.waitFor(() => expect(mcpAppsApi.endpoints.getMcpAppEntrypoints.select("codex")(store.getState()).data).toEqual([app]));
      entries = [];
      await store.dispatch(providersApi.endpoints.setProviderPluginEnabled.initiate({ providerId: "codex", pluginId: "canvas", enabled: false })).unwrap();
      await vi.waitFor(() => expect(mcpAppsApi.endpoints.getMcpAppEntrypoints.select("codex")(store.getState()).data).toEqual([]));
      entries = [{ ...app, name: "New canvas" }];
      await store.dispatch(providersApi.endpoints.updateProviderPlugin.initiate({ providerId: "codex", pluginId: "canvas" })).unwrap();
      await vi.waitFor(() => expect(mcpAppsApi.endpoints.getMcpAppEntrypoints.select("codex")(store.getState()).data?.[0].name).toBe("New canvas"));
      entries = [];
      await store.dispatch(providersApi.endpoints.uninstallProviderPlugin.initiate({ providerId: "codex", pluginId: "canvas" })).unwrap();
      await vi.waitFor(() => expect(mcpAppsApi.endpoints.getMcpAppEntrypoints.select("codex")(store.getState()).data).toEqual([]));
    } finally {
      query.unsubscribe();
      store.dispatch(baseApi.util.resetApiState());
    }
  });
});
