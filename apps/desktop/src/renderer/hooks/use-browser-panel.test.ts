// @vitest-environment jsdom
import { createElement, type ReactNode, type ComponentProps } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ mode: "developer", setContext: vi.fn(), createTab: vi.fn(), createHtmlPreviewTab: vi.fn() }));
vi.mock("./use-mode-config", () => ({ useModeConfig: () => ({ mode: mock.mode }) }));
import settings from "@/lib/redux/slices/appSettingsSlice";
import workspace, { activateWorkspaceView, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import preview, { openPreviewTab, setPreviewExpanded } from "@/lib/redux/slices/previewSlice";
import { BrowserPanelProvider, useBrowserPanel } from "./use-browser-panel";
import { workspaceBrowserExpansionKey } from "../../shared/ui-state-keys";
function harness() {
  const state = configureStore({ reducer: { appSettings: settings, workspace, preview, backends: () => ({ activeBackendId: null }) } });
  state.dispatch(activateWorkspaceView({ key: "ws-1", workspaceId: "ws-1", providerId: "codex" }));
  state.dispatch(setComposerContextKey("chat-1"));
  let navigate!: ReturnType<typeof useNavigate>;
  const hook = renderHook(() => { navigate = useNavigate(); return useBrowserPanel(); }, {
    wrapper: ({ children }: { children: ReactNode }) => createElement(Provider, { store: state } as ComponentProps<typeof Provider>,
      createElement(MemoryRouter, null, createElement(BrowserPanelProvider, null, children))),
  });
  return { ...hook, state, navigate: (path: string) => navigate(path) };
}
beforeEach(() => {
  vi.clearAllMocks(); mock.mode = "developer";
  mock.setContext.mockResolvedValue({ success: true });
  let count = 0;
  const created = () => ({ success: true, data: { activeTabId: `page-${++count}`, tabs: Array.from({ length: count }, (_, i) => ({ tabId: `page-${i + 1}`, title: `Page ${i + 1}`, faviconUrl: null, isLoading: false, isCrashed: false })) } });
  mock.createTab.mockImplementation(async () => created());
  mock.createHtmlPreviewTab.mockImplementation(async () => created());
  Object.defineProperty(window, "api", { configurable: true, value: { browser: mock } });
});
afterEach(cleanup);
describe("browser preview integration", () => {
  it("opens multiple native pages alongside an existing document in the Code workspace", async () => {
    const h = harness(); const key = workspaceBrowserExpansionKey(null, "ws-1");
    act(() => h.state.dispatch(openPreviewTab({ ownerKey: key, tab: { kind: "document", id: "pdf", doc: { path: "/a.pdf", fileName: "a.pdf", docType: "pdf" } } })));
    await act(async () => { await h.result.current.openUrl("https://example.com"); await h.result.current.newTab(); });
    expect(mock.createTab).toHaveBeenNthCalledWith(1, "https://example.com", key);
    expect(h.state.getState().preview.byOwner[key].tabs.map((tab) => tab.id)).toEqual(["pdf", "page-1", "page-2"]);
    expect(h.result.current.ownerKey).toBe("chat-1");
    expect(h.result.current.tabOwnerKey).toBe(key);
    act(() => h.state.dispatch(setComposerContextKey("chat-2")));
    expect(h.result.current.isOpen).toBe(true);
    expect(h.state.getState().preview.byOwner[key].tabs).toHaveLength(3);
  });
  it("opens HTML previews in the same group", async () => {
    const h = harness();
    await act(async () => h.result.current.openHtmlFile("/tmp/preview.html"));
    expect(mock.createHtmlPreviewTab).toHaveBeenCalledWith("/tmp/preview.html", workspaceBrowserExpansionKey(null, "ws-1"));
    expect(mock.createTab).not.toHaveBeenCalled();
  });
  it("hides previews on Settings and restores selection on return without closing tabs", async () => {
    const h = harness(); await act(async () => h.result.current.newTab());
    act(() => h.navigate("/settings")); expect(h.result.current.isOpen).toBe(false);
    act(() => h.navigate("/code/ws-1")); expect(h.result.current.isOpen).toBe(true);
    act(() => h.result.current.close());
    expect(h.state.getState().preview.byOwner[h.result.current.tabOwnerKey].tabs).toHaveLength(1);
  });
  it.each(["work", "chat"])("isolates %s browser tabs by conversation", async (mode) => {
    mock.mode = mode; const h = harness(); await act(async () => h.result.current.newTab());
    act(() => h.state.dispatch(setComposerContextKey("chat-2")));
    expect(h.result.current.isOpen).toBe(false);
    act(() => h.state.dispatch(setComposerContextKey("chat-1")));
    expect(h.result.current.isOpen).toBe(true);
  });
  it("keeps Atlas docked without changing the workspace expansion preference", async () => {
    const h = harness(); await act(async () => h.result.current.newTab());
    const key = h.result.current.tabOwnerKey;
    act(() => h.state.dispatch(setPreviewExpanded({ ownerKey: key, expanded: true })));
    expect(h.result.current.isExpanded).toBe(true);
    act(() => h.navigate("/atlas/page-1"));
    expect(h.result.current.canExpand).toBe(false);
    act(() => h.result.current.toggleExpanded());
    act(() => h.navigate("/code/ws-1"));
    expect(h.result.current.isExpanded).toBe(true);
  });
});
