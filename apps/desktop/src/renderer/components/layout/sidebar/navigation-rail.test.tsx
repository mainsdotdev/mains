// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";

const mocks = vi.hoisted(() => ({ openGlobal: vi.fn(), closePanel: vi.fn(), homeClick: vi.fn(),
  entries: [] as McpAppEntrypoint[], providerId: "codex", panelOpen: false, expanded: false }));
const app: McpAppEntrypoint = {
  id: "magicpath/account-1", name: "MagicPath", server: "codex_apps", tool: "magicpath.open_canvas",
  resourceUri: "ui://magicpath/canvas", entrypoints: ["global"], preferredModelDisplayMode: "fullscreen",
};
vi.mock("@/hooks/use-app-theme", () => ({
  useResolvedAppTheme: () => ({ light: { translucent: false }, dark: { translucent: false } }),
}));
vi.mock("@/features/workspace/components/realtime-voice-dock", () => ({ RealtimeVoiceDock: () => null }));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({ useKeyboardShortcutBinding: () => null }));
vi.mock("@/hooks/use-mcp-app-extensions", () => ({
  useMcpAppExtensions: () => ({ available: true, entries: mocks.entries, isLoading: false }),
}));
vi.mock("@/hooks/use-space-provider-variant", () => ({ useSpaceProviderVariant: () => ({ providerId: mocks.providerId }) }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({
  useMcpAppPanel: () => ({ openGlobal: mocks.openGlobal, close: mocks.closePanel, opening: app.id,
    isOpen: mocks.panelOpen, expanded: mocks.expanded, document: { app } }),
}));
vi.mock("./mcp-app-icon", () => ({ McpAppIcon: () => <span data-testid="app-logo" /> }));
import { NavigationRail } from "./navigation-rail";
import McpAppPage from "@/routes/McpApp";
import { mcpAppPinKey } from "@/lib/mcp-app-extensions";
import appSettingsReducer, { setMcpAppPinned } from "@/lib/redux/slices/appSettingsSlice";
import { getProviderVariantById } from "@/lib/provider-variants";

function railStore() { return configureStore({ reducer: { appSettings: appSettingsReducer } }); }
function tree(state: ReturnType<typeof railStore>) {
  return <Provider store={state}><MemoryRouter initialEntries={["/code/ws-1"]}>
    <NavigationRail showTasks={false} pluginsAvailable atlasAvailable={!!getProviderVariantById(mocks.providerId)?.supportsAtlas} spaces={[]} activeSpaceId={null}
      onHomeClick={mocks.homeClick} onSpaceChange={vi.fn()} onSettingsClick={vi.fn()} onHelpClick={vi.fn()} helpMenuOpen={false} />
    <Routes>
      <Route path="/code/:workspaceId" element={<div>Conversation</div>} />
      <Route path="/apps/:appId" element={<McpAppPage />} />
      <Route path="/plugins" element={<div>Plugins page</div>} />
      <Route path="/atlas" element={<div>Atlas page</div>} />
    </Routes>
  </MemoryRouter></Provider>;
}
function renderRail() {
  const state = railStore();
  return { ...render(tree(state)), state };
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.entries = [app]; mocks.providerId = "codex";
  mocks.panelOpen = false; mocks.expanded = false;
  mocks.openGlobal.mockReturnValue(new Promise<void>(() => {}));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("rail app navigation", () => {
  it.each(["copilot_cli", "cursor"])("disables Atlas for %s", (providerId) => {
    mocks.providerId = providerId;
    renderRail();
    const button = screen.getByRole("button", { name: "Atlas" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByText("Atlas page")).toBeNull();
    expect(screen.getByText("Conversation")).toBeTruthy();
  });

  it.each(["claude_code", "codex"])("opens Atlas for %s", (providerId) => {
    mocks.providerId = providerId;
    renderRail();
    const button = screen.getByRole("button", { name: "Atlas" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(screen.getByText("Atlas page")).toBeTruthy();
  });

  it.each([false, true])("closes the app before the Home action on the same conversation route (expanded: %s)", (expanded) => {
    mocks.panelOpen = true; mocks.expanded = expanded;
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(mocks.closePanel).toHaveBeenCalledOnce();
    expect(mocks.homeClick).toHaveBeenCalledOnce();
    expect(mocks.closePanel.mock.invocationCallOrder[0]).toBeLessThan(mocks.homeClick.mock.invocationCallOrder[0]);
    expect(screen.getByText("Conversation")).toBeTruthy();
  });

  it("also cancels an app opening before returning Home from its loading page", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "App options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "MagicPath" }));
    expect(screen.getByRole("status").textContent).toBe("Opening MagicPath…");
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(mocks.closePanel).toHaveBeenCalledOnce();
    expect(mocks.homeClick).toHaveBeenCalledOnce();
  });

  it.each([false, true])("deactivates Home while an MCP app is open (expanded: %s), then restores it on close", (expanded) => {
    const h = renderRail();
    act(() => h.state.dispatch(setMcpAppPinned({ providerId: "codex", pinKey: mcpAppPinKey(app), pinned: true,
      availablePinKeys: [mcpAppPinKey(app)] })));
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    mocks.panelOpen = true; mocks.expanded = expanded;
    h.rerender(tree(h.state));
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "MagicPath" }).getAttribute("aria-current")).toBe("page");
    mocks.panelOpen = false;
    h.rerender(tree(h.state));
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "MagicPath" }).getAttribute("aria-current")).toBeNull();
  });

  it("starts with only an options button and lists all apps inside its menu", () => {
    mocks.entries = Array.from({ length: 8 }, (_, i) => ({ ...app, id: `app-${i}`, pluginId: `plugin-${i}`, name: `App ${i + 1}` }));
    const h = renderRail();
    expect(screen.queryByRole("button", { name: /^App \d+$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "App options" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(8);
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(8);
    expect(h.state.getState().appSettings.pinnedMcpAppKeysByProvider).toEqual({});
  });

  it("hides the options button when there are no MCP apps, including while its menu was open", () => {
    const h = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "App options" }));
    mocks.entries = [];
    h.rerender(tree(h.state));
    expect(screen.queryByRole("button", { name: "App options" })).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the loading page immediately while keeping its logo and navigation available", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "App options" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Pin MagicPath" }));
    expect(mocks.openGlobal).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
    const appButton = screen.getByRole("button", { name: "MagicPath" }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("menuitem", { name: "MagicPath" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("Conversation")).toBeNull();
    expect(screen.getByRole("heading", { name: "MagicPath" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Opening MagicPath…");
    expect(mocks.openGlobal).toHaveBeenCalledWith(app);
    expect(appButton.getAttribute("aria-current")).toBe("page");
    expect(appButton.disabled).toBe(false);
    expect(appButton.querySelector('[data-testid="app-logo"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByText("Plugins page")).toBeTruthy();
  });

  it("limits the rail to five pins and leaves unpinned apps in the menu without filling the gap", () => {
    mocks.entries = Array.from({ length: 7 }, (_, i) => ({ ...app, id: `app-${i}`, pluginId: `plugin-${i}`, name: `App ${i + 1}` }));
    const h = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "App options" }));
    for (let i = 1; i <= 5; i++) fireEvent.click(screen.getByRole("menuitemcheckbox", { name: `Pin App ${i}` }));
    const sixthPin = screen.getByRole("menuitemcheckbox", { name: "Pin App 6" }) as HTMLButtonElement;
    expect(sixthPin.disabled).toBe(true);
    fireEvent.click(sixthPin);
    expect(h.state.getState().appSettings.pinnedMcpAppKeysByProvider.codex).toHaveLength(5);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Unpin App 2" }));
    expect(screen.queryByRole("button", { name: "App 2" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "App 2" })).toBeTruthy();
    expect(h.state.getState().appSettings.pinnedMcpAppKeysByProvider.codex).toHaveLength(4);
    fireEvent.click(sixthPin);
    const rail = screen.getByRole("navigation", { name: "Pages" });
    expect(within(rail).getAllByRole("button", { name: /^App \d+$/ }).map((button) => button.getAttribute("aria-label")))
      .toEqual(["App 1", "App 3", "App 4", "App 5", "App 6"]);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(mocks.openGlobal).not.toHaveBeenCalled();
  });

  it("keeps pin preferences when providers change and never pins newly discovered apps automatically", () => {
    const h = renderRail();
    act(() => h.state.dispatch(setMcpAppPinned({ providerId: "codex", pinKey: mcpAppPinKey(app), pinned: true, availablePinKeys: [mcpAppPinKey(app)] })));
    mocks.entries = [app, { ...app, id: "new-app", pluginId: "another-plugin", name: "New app" }];
    h.rerender(tree(h.state));
    expect(screen.getByRole("button", { name: "MagicPath" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New app" })).toBeNull();
    mocks.providerId = "claude_code";
    h.rerender(tree(h.state));
    expect(screen.queryByRole("button", { name: "MagicPath" })).toBeNull();
    mocks.providerId = "codex";
    h.rerender(tree(h.state));
    expect(screen.getByRole("button", { name: "MagicPath" })).toBeTruthy();
  });

  it("allows keyboard pinning without opening the app and Escape closes the menu", async () => {
    renderRail();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "App options" }));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "MagicPath" }));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("menuitemcheckbox", { name: "Unpin MagicPath" }).getAttribute("aria-checked")).toBe("true");
    expect(mocks.openGlobal).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("retains a pin after account reconnection and opens the current connection", () => {
    mocks.entries = [{ ...app, pluginId: "magicpath@catalog", connectorId: "magicpath", linkId: "old-link" }];
    const h = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "App options" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Pin MagicPath" }));
    const keys = h.state.getState().appSettings.pinnedMcpAppKeysByProvider.codex;
    const reconnected = { ...mocks.entries[0], id: "new-connection", linkId: "new-link" };
    mocks.entries = [reconnected];
    h.rerender(tree(h.state));
    expect(h.state.getState().appSettings.pinnedMcpAppKeysByProvider.codex).toEqual(keys);
    fireEvent.click(screen.getByRole("button", { name: "MagicPath" }));
    expect(mocks.openGlobal).toHaveBeenCalledWith(reconnected);
  });

  it("reconciles saved legacy pins and shows one rail icon for multiple accounts", () => {
    const oldId = JSON.stringify([app.server, app.tool, "magicpath", "old-link"]);
    mocks.entries = [
      { ...app, id: "account-one", pluginId: "magicpath@catalog", connectorId: "magicpath", linkId: "one" },
      { ...app, id: "account-two", pluginId: "magicpath@catalog", connectorId: "magicpath", linkId: "two" },
    ];
    const h = renderRail();
    act(() => h.state.dispatch(setMcpAppPinned({ providerId: "codex", pinKey: oldId, pinned: true, availablePinKeys: [oldId] })));
    expect(h.state.getState().appSettings.pinnedMcpAppKeysByProvider.codex).toEqual([mcpAppPinKey(mocks.entries[0])]);
    expect(screen.getAllByRole("button", { name: "MagicPath" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "App options" }));
    const pins = screen.getAllByRole("menuitemcheckbox", { name: "Unpin MagicPath" });
    expect(pins).toHaveLength(2);
    fireEvent.click(pins[1]);
    expect(screen.queryByRole("button", { name: "MagicPath" })).toBeNull();
  });
});
