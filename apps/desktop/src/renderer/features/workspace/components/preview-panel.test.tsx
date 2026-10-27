// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: "developer" }) }));
vi.mock("@/hooks/use-shell-header-chrome", () => ({ useShellHeaderChrome: () => ({}) }));
vi.mock("@/hooks/use-is-dark-mode", () => ({ useIsDarkMode: () => false }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppInstances: () => [] }));
vi.mock("./browser-panel", () => ({ BrowserPanel: () => <div>Browser content host</div> }));
vi.mock("./document-viewer-panel", () => ({ DocumentViewerPanel: () => null }));
vi.mock("./mcp-app-panel", () => ({ McpAppPanel: () => null }));
import settings, { setSidebarCollapsed } from "@/lib/redux/slices/appSettingsSlice";
import workspace, { activateWorkspaceView, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import preview, { openPreviewTab, setPreviewOpen, setPreviewExpanded, type PreviewTab } from "@/lib/redux/slices/previewSlice";
import { workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";
import { PreviewPanel } from "./preview-panel";
import { PreviewTabLifecycleProvider, usePreviewTabLifecycle } from "@/hooks/use-preview-tab-lifecycle";
const key = workspaceBrowserExpansionKey(null, "ws");
const file: PreviewTab = { kind: "document", id: "pdf", doc: { path: "/tmp/a.pdf", fileName: "Report.pdf", docType: "pdf" } };
function harness(tabs: PreviewTab[] = [file]) {
  const state = configureStore({ reducer: { appSettings: settings, workspace, preview, backends: () => ({ activeBackendId: null }) } });
  state.dispatch(activateWorkspaceView({ key: "ws", workspaceId: "ws", providerId: "codex" }));
  state.dispatch(setComposerContextKey("chat"));
  tabs.forEach((tab) => state.dispatch(openPreviewTab({ ownerKey: key, tab })));
  let lifecycle!: ReturnType<typeof usePreviewTabLifecycle>;
  function Consumer() { lifecycle = usePreviewTabLifecycle(); return null; }
  render(<Provider store={state}><MemoryRouter><PreviewTabLifecycleProvider><Consumer /><PreviewPanel /></PreviewTabLifecycleProvider></MemoryRouter></Provider>);
  return { state, prepare: (id: string, callback: () => Promise<void>) => lifecycle.register(id, callback) };
}
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("shared preview shell", () => {
  it("preserves sidebar choices when expanding and switching between app, browser and document tabs", () => {
    const page: PreviewTab = { kind: "browser", id: "page", title: "Page", faviconUrl: null, isLoading: false, isCrashed: false };
    const h = harness([file, page, { kind: "app", id: "app", title: "Canvas" }]);
    act(() => h.state.dispatch(setPreviewExpanded({ ownerKey: key, expanded: true })));
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Page" }));
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Report.pdf" }));
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(false);
    act(() => h.state.dispatch(setSidebarCollapsed(true)));
    fireEvent.click(screen.getByRole("tab", { name: "Canvas" }));
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(true);
    act(() => h.state.dispatch(setSidebarCollapsed(false)));
    expect(h.state.getState().appSettings.sidebarCollapsed).toBe(false);
  });

  it("selects heterogeneous tabs in one header and closes only the selected resource", async () => {
    const h = harness([{ kind: "app", id: "app", title: "Canvas" }, file]);
    const tabs = screen.getByRole("tablist", { name: "Preview tabs" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Canvas" }));
    expect(h.state.getState().preview.byOwner[key].activeTabId).toBe("app");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close Report.pdf" })));
    expect(h.state.getState().preview.byOwner[key].tabs.map((tab) => tab.id)).toEqual(["app"]);
  });
  it("hiding the panel retains tabs and the active resource", () => {
    const h = harness();
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(h.state.getState().preview.byOwner[key]).toMatchObject({ open: false, activeTabId: "pdf" });
    expect(h.state.getState().preview.byOwner[key].tabs).toHaveLength(1);
    act(() => h.state.dispatch(setPreviewOpen({ ownerKey: key, open: true })));
    expect(screen.getByRole("tab", { name: "Report.pdf" })).toBeTruthy();
  });
  it("waits for an app's save barrier before closing that tab", async () => {
    const h = harness([{ kind: "app", id: "app", title: "Canvas" }]);
    let saved!: () => void;
    h.prepare("app", () => new Promise<void>((resolve) => { saved = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Close Canvas" }));
    expect(h.state.getState().preview.byOwner[key].tabs).toHaveLength(1);
    await act(async () => saved());
    expect(h.state.getState().preview.byOwner[key].tabs).toHaveLength(0);
    expect(h.state.getState().preview.byOwner[key].open).toBe(false);
  });
  it("respects a native browser close veto and keeps other preview types", async () => {
    const page: PreviewTab = { kind: "browser", id: "page", title: "Unsaved page", faviconUrl: null, isLoading: false, isCrashed: false };
    const h = harness([file, page]);
    const closeTab = vi.fn(async () => ({ success: true, data: { ownerKey: key, activeTabId: "page", tabs: [{ ...page, tabId: "page" }] } }));
    Object.defineProperty(window, "api", { configurable: true, value: { browser: { closeTab } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close Unsaved page" })));
    expect(h.state.getState().preview.byOwner[key].tabs).toHaveLength(2);
    expect(h.state.getState().preview.byOwner[key].activeTabId).toBe("page");
  });
});
