// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
const mode = vi.hoisted(() => ({ value: "developer" }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: mode.value }) }));
import appSettings from "@/lib/redux/slices/appSettingsSlice";
import workspace, { activateWorkspaceView, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import preview, { openPreviewTab } from "@/lib/redux/slices/previewSlice";
import { workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";
import { useOpenPullRequest } from "./use-open-pull-request";

afterEach(() => { cleanup(); mode.value = "developer"; });
function harness(path = "/code") {
  const state = configureStore({ reducer: { appSettings, workspace, preview, backends: () => ({ activeBackendId: "remote" }) } });
  state.dispatch(activateWorkspaceView({ key: "ws", workspaceId: "ws", providerId: "codex" }));
  state.dispatch(setComposerContextKey("chat-1"));
  const hook = renderHook(() => useOpenPullRequest(), { wrapper: ({ children }: { children: ReactNode }) =>
    <Provider store={state}><MemoryRouter initialEntries={[path]}>{children}</MemoryRouter></Provider> });
  return { state, ...hook };
}

describe("opening PR previews", () => {
  it("reselects one PR beside other resources and scopes it to the remote workspace", () => {
    const h = harness();
    const ownerKey = workspaceBrowserExpansionKey("remote", "ws");
    act(() => h.result.current("https://github.com/Acme/Widget/pull/176"));
    const firstId = h.state.getState().preview.byOwner[ownerKey].activeTabId;
    act(() => h.state.dispatch(openPreviewTab({ ownerKey, tab: { kind: "app", id: "app", title: "Canvas" } })));
    act(() => h.result.current("https://github.com/acme/widget/pull/176/files#diff"));
    const group = h.state.getState().preview.byOwner[ownerKey];
    expect(group.tabs).toHaveLength(2);
    expect(group.activeTabId).toBe(firstId);
    expect(group.tabs[0]).toMatchObject({ kind: "pull-request", prRef: { provider: "github", owner: "acme", repo: "widget", number: 176 } });
    expect(group.open).toBe(true);
  });
  it.each(["work", "chat"])("keeps %s previews with their conversation", (value) => {
    mode.value = value;
    const h = harness();
    act(() => h.result.current("https://github.com/acme/widget/pull/176"));
    act(() => h.state.dispatch(setComposerContextKey("chat-2")));
    act(() => h.result.current("https://github.com/acme/widget/pull/177"));
    expect(h.state.getState().preview.byOwner["chat-1"].tabs).toHaveLength(1);
    expect(h.state.getState().preview.byOwner["chat-2"].tabs).toHaveLength(1);
  });
  it("does not swallow links on surfaces where previews cannot be shown", () => {
    const h = harness("/tasks");
    expect(h.result.current("https://github.com/acme/widget/pull/176")).toBe(false);
    expect(h.state.getState().preview.byOwner).toEqual({});
  });
});
