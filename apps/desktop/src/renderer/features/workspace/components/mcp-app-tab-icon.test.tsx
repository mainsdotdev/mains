// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import type { PluginListResponse } from "@/lib/redux/api/providersApi";

const mocks = vi.hoisted(() => ({ data: undefined as PluginListResponse | undefined, query: vi.fn() }));
vi.mock("@/lib/redux/api/providersApi", () => ({
  useGetProviderInstalledPluginsQuery: (...args: unknown[]) => {
    mocks.query(...args);
    return { currentData: mocks.data };
  },
}));
vi.mock("@/hooks/use-is-dark-mode", () => ({ useIsDarkMode: () => false }));
vi.mock("@/hooks/use-local-image-url", () => ({ useLocalImageUrl: (src?: string) => src }));
import { McpAppTabIcon } from "./mcp-app-tab-icon";

const app: McpAppEntrypoint = {
  id: "flights", name: "Skyscanner", server: "codex_apps", tool: "skyscanner.search",
  connectorId: "opaque-connector-id", resourceUri: "ui://flights", entrypoints: ["thread"],
  preferredModelDisplayMode: "fullscreen",
};
const plugin = {
  id: "app-123@catalog", name: "app-123", installed: true, enabled: true,
  source: { type: "remote", path: "" }, installPolicy: "AVAILABLE" as const, authPolicy: "ON_INSTALL" as const,
  interface: { displayName: "Skyscanner", logo: "https://example.com/skyscanner.svg", capabilities: [], screenshots: [] },
};
const inventory: PluginListResponse = {
  marketplaces: [{ name: "catalog", path: "", interface: null, plugins: [plugin] }],
  marketplaceLoadErrors: [], remoteSyncError: null, featuredPluginIds: [],
};
beforeEach(() => { mocks.data = inventory; mocks.query.mockClear(); });
afterEach(cleanup);

describe("MCP app tab branding", () => {
  it("uses the installed plugin logo for a chat-only app with an opaque connector id", () => {
    const { container } = render(<McpAppTabIcon app={app} providerId="codex" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(plugin.interface.logo);
  });

  it("updates a tab when plugin metadata arrives after it opens", () => {
    mocks.data = undefined;
    const { container, rerender } = render(<McpAppTabIcon app={app} providerId="codex" />);
    expect(container.querySelector("img")).toBeNull();
    mocks.data = inventory;
    rerender(<McpAppTabIcon app={app} providerId="codex" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(plugin.interface.logo);
  });

  it("keeps supplied app icons without fetching plugin branding", () => {
    const { container } = render(<McpAppTabIcon app={{ ...app, icons: [{ src: "tool.svg" }] }} providerId="codex" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("tool.svg");
    expect(mocks.query).toHaveBeenCalledWith("codex", { skip: true });
  });

  it("prefers explicit plugin ownership over another plugin with a matching tool namespace", () => {
    mocks.data = { ...inventory, marketplaces: [{ ...inventory.marketplaces[0], plugins: [plugin,
      { ...plugin, id: "owner@catalog", name: "owner", interface: { ...plugin.interface, logo: "owner.svg" } }] }] };
    const { container, rerender } = render(<McpAppTabIcon app={{ ...app, pluginId: "owner@catalog" }} providerId="codex" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("owner.svg");
    rerender(<McpAppTabIcon app={{ ...app, pluginId: "missing@catalog" }} providerId="codex" />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not borrow Codex branding for another provider", () => {
    const { container } = render(<McpAppTabIcon app={app} providerId="claude_code" />);
    expect(container.querySelector("img")).toBeNull();
    expect(mocks.query).toHaveBeenCalledWith("claude_code", { skip: true });
  });
});
