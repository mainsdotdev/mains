// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./use-mode-config", () => ({ useModeConfig: () => ({ mode: "developer" }) }));
import appSettings, { setRightPanelOpen, setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import workspace from "@/lib/redux/slices/workspaceSlice";
import preview, { openPreviewTab } from "@/lib/redux/slices/previewSlice";
import { DocumentViewerProvider, useDocumentViewer } from "./use-document-viewer";
afterEach(cleanup);
describe("document preview tabs", () => {
  it.each(["pdf", "xlsx", "docx"] as const)("opens real %s files alongside other resources in Atlas", (docType) => {
    const state = configureStore({ reducer: { appSettings, workspace, preview, backends: () => ({ activeBackendId: null }) } });
    const key = JSON.stringify(["local", "atlas-preview"]);
    state.dispatch(setRightPanelOpen(true)); state.dispatch(setSessionPanelOpen(true));
    state.dispatch(openPreviewTab({ ownerKey: key, tab: { kind: "browser", id: "page", title: "Page", faviconUrl: null, isLoading: false, isCrashed: false } }));
    const h = renderHook(() => useDocumentViewer(), { wrapper: ({ children }: { children: ReactNode }) =>
      <Provider store={state}><MemoryRouter initialEntries={["/atlas"]}><DocumentViewerProvider>{children}</DocumentViewerProvider></MemoryRouter></Provider> });
    const first = { path: `/tmp/report.${docType}`, fileName: `report.${docType}`, docType };
    act(() => h.result.current.open(first));
    const id = state.getState().preview.byOwner[key].activeTabId;
    act(() => h.result.current.open({ ...first, path: `/tmp/second.${docType}` }));
    act(() => h.result.current.open(first));
    expect(h.result.current.currentDoc).toEqual(first);
    expect(state.getState().preview.byOwner[key].activeTabId).toBe(id);
    expect(state.getState().preview.byOwner[key].tabs).toHaveLength(3);
    expect(state.getState().appSettings.rightPanelOpen).toBe(false);
    expect(state.getState().appSettings.sessionPanelOpen).toBe(false);
  });
});
