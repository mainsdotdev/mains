// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { mcpAppPath } from "@/lib/mcp-app-extensions";
const mocks = vi.hoisted(() => ({ entries: [] as McpAppEntrypoint[], openGlobal: vi.fn(), openExternal: vi.fn(), error: null as string | null }));
vi.mock("@/hooks/use-mcp-app-extensions", () => ({ useMcpAppExtensions: () => ({ available: true, entries: mocks.entries, isLoading: false }) }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => ({ openGlobal: mocks.openGlobal, error: mocks.error }) }));
vi.mock("@/hooks/use-space-provider-variant", () => ({ useSpaceProviderVariant: () => ({ providerId: "codex" }) }));
import McpAppPage from "./McpApp";
function entry(id: string): McpAppEntrypoint { return { id, name: "Canvas", server: "codex_apps", tool: "canvas.home", resourceUri: "ui://canvas",
  entrypoints: ["global"], preferredModelDisplayMode: "fullscreen" }; }
function PluginDestination() {
  const location = useLocation();
  return createElement("div", { "data-testid": "plugin-destination" }, location.pathname + location.search);
}
function tree(id: string) { return createElement(MemoryRouter, { initialEntries: [mcpAppPath({ id })] },
  createElement(Routes, null, createElement(Route, { path: "/apps/:appId", element: createElement(McpAppPage) }),
    createElement(Route, { path: "/plugins", element: createElement(PluginDestination) }))); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.error = null; mocks.entries = [entry("canvas")]; mocks.openGlobal.mockResolvedValue(undefined);
  mocks.openExternal.mockResolvedValue({ success: true });
  Object.defineProperty(window, "api", { configurable: true, value: { shell: { openExternal: mocks.openExternal } } });
});
afterEach(cleanup);
describe("MCP App deep links", () => {
  it("shows Notion's browser fallback immediately without starting an app session", () => {
    mocks.entries = [{ ...entry("notion"), tool: "notion.notion-page-view", name: "Notion", linkId: "account-1" }];
    render(tree("notion"));
    expect(screen.getByRole("status").textContent).toContain("not supported in Mains");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(mocks.openGlobal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith("https://app.notion.com/");
  });
  it("routes an unlinked Canva account to its own provider and plugin setup", () => {
    mocks.entries = [{ ...entry("canva"), tool: "canva.openai-home", name: "Canva",
      pluginId: "canva@catalog", linkId: "synthetic_link::canva" }];
    mocks.error = "Unknown resource (code: -32002)";
    render(tree("canva"));
    expect(screen.getByRole("status").textContent).toContain("account isn't connected");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.openGlobal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Canva" }));
    const destination = screen.getByTestId("plugin-destination").textContent!;
    expect(destination).toBe("/plugins?provider=codex&plugin=canva%40catalog");
  });
  it("opens Canva normally once an authenticated account appears", async () => {
    mocks.entries = [{ ...entry("canva"), tool: "canva.openai-home", name: "Canva", linkId: null }];
    const page = render(tree("canva"));
    expect(mocks.openGlobal).not.toHaveBeenCalled();
    mocks.entries = [{ ...mocks.entries[0], linkId: "account-1" }];
    page.rerender(tree("canva"));
    await waitFor(() => expect(mocks.openGlobal).toHaveBeenCalledExactlyOnceWith(mocks.entries[0]));
    expect(screen.queryByRole("button", { name: "Reconnect Canva" })).toBeNull();
  });
  it("launches the shared panel instead of owning a second document", async () => {
    render(tree("canvas"));
    await waitFor(() => expect(mocks.openGlobal).toHaveBeenCalledWith(mocks.entries[0]));
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("shows the app page while the connection is still pending", () => {
    mocks.openGlobal.mockReturnValue(new Promise<void>(() => {}));
    render(tree("canvas"));
    expect(screen.getByRole("heading", { name: "Canvas" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Opening Canvas…");
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("keeps connection errors inside the page and allows retrying", () => {
    const page = render(tree("canvas"));
    mocks.error = "Connection failed";
    page.rerender(tree("canvas"));
    expect(screen.getByRole("alert").textContent).toBe("Connection failed");
    expect(screen.queryByRole("note", { name: "App compatibility" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.openGlobal).toHaveBeenCalledTimes(2);
    expect(mocks.openGlobal).toHaveBeenLastCalledWith(mocks.entries[0]);
  });
  it("leaves compatibility notifications to the shared host, including when opening fails", () => {
    mocks.entries = [{ ...entry("figma"), tool: "figma.open_canvas", name: "Figma" }];
    mocks.error = "Connection could not be validated";
    render(tree("figma"));
    expect(screen.queryByRole("note", { name: "App compatibility" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Connection could not be validated");
  });
  it("keeps the launch across inventory metadata refreshes", async () => {
    const page = render(tree("canvas"));
    await waitFor(() => expect(mocks.openGlobal).toHaveBeenCalledOnce());
    mocks.entries = [{ ...entry("canvas"), icons: [{ src: "https://example.com/icon.svg" }] }];
    page.rerender(tree("canvas"));
    expect(mocks.openGlobal).toHaveBeenCalledOnce();
  });
  it("explains unavailable plugins", () => {
    render(tree("missing"));
    expect(screen.getByRole("alert").textContent).toContain("no longer available");
    expect(mocks.openGlobal).not.toHaveBeenCalled();
  });
  it("preserves the full encoded connector/account identity", async () => {
    const id = JSON.stringify(["server", "canvas.home", "connector/1", "account %2F /"]);
    mocks.entries = [entry(id)];
    render(tree(id));
    await waitFor(() => expect(mocks.openGlobal).toHaveBeenCalledWith(mocks.entries[0]));
  });
});
