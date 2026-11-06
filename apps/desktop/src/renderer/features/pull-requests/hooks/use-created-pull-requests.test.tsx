// @vitest-environment jsdom
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { RunPullRequestCreatedEvent } from "@mains/contracts/runs";
import { baseApi } from "@/lib/redux/api/baseApi";
import appSettings, { setRightPanelOpen, setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import workspace, { activateWorkspaceView, setActiveTab, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import backends, { setActiveBackend } from "@/lib/redux/slices/backendsSlice";
import preview, { closePreviewTab, openPreviewTab, setPreviewOpen } from "@/lib/redux/slices/previewSlice";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { runOwnerKey, workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";
import { useCreatedPullRequests } from "./use-created-pull-requests";

const event: RunPullRequestCreatedEvent = { runId: "run-a", workspaceId: "ws", mode: "developer", toolCallId: 42, url: "https://github.com/acme/widget/pull/176" };
const owner = workspaceBrowserExpansionKey(null, "ws");
function fakeTransport() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const transport: Transport = {
    kind: "test", invoke: vi.fn(async () => ({ success: true as const, data: undefined })),
    subscribe(channel, listener) {
      const group = listeners.get(channel) ?? new Set(); group.add(listener); listeners.set(channel, group);
      return () => { group.delete(listener); };
    },
    status: () => "connected", onStatusChange: () => () => {},
  };
  return { transport, listeners, emit: (channel: string, payload: unknown) => { for (const listener of listeners.get(channel) ?? []) listener(payload); } };
}
const states: ReturnType<typeof makeStore>[] = [];
function makeStore() {
  return configureStore({ reducer: { appSettings, workspace, backends, preview, api: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
}
function harness(path = "/code/ws") {
  const source = fakeTransport(); setTransport(source.transport);
  const state = makeStore(); states.push(state);
  state.dispatch(activateWorkspaceView({ key: "view-ws", workspaceId: "ws", providerId: "codex" }));
  state.dispatch(setActiveTab("run-a"));
  state.dispatch(setComposerContextKey(runOwnerKey(null, "run-a")));
  state.dispatch(setSessionPanelOpen(true)); state.dispatch(setRightPanelOpen(true));
  const hook = renderHook(() => { useCreatedPullRequests(); return useNavigate(); }, {
    wrapper: ({ children }: { children: ReactNode }) => <Provider store={state}><MemoryRouter initialEntries={[path]}>{children}</MemoryRouter></Provider>,
  });
  return { state, source, ...hook };
}
afterEach(() => {
  cleanup(); resetTransport();
  for (const state of states.splice(0)) state.dispatch(baseApi.util.resetApiState());
});

describe("automatic PR previews", () => {
  it("opens a PR beside the chat that created it without changing the selected chat", () => {
    const h = harness();
    act(() => h.source.emit(CHANNELS.runs.pullRequestCreated, event));
    const state = h.state.getState();
    expect(state.preview.byOwner[owner]).toMatchObject({ open: true, activeTabId: "pull-request:github:acme/widget#176" });
    expect(state.workspace.activeTab).toBe("run-a");
    expect(state.appSettings.rightPanelOpen).toBe(false);
    expect(state.appSettings.sessionPanelOpen).toBe(false);
  });

  it.each([true, false])("keeps another chat's preview selection and open state (%s) in the same workspace", (open) => {
    const h = harness();
    act(() => {
      h.state.dispatch(setActiveTab("run-b"));
      h.state.dispatch(setComposerContextKey(runOwnerKey(null, "run-b")));
      h.state.dispatch(openPreviewTab({ ownerKey: owner, tab: { kind: "app", id: "canvas", title: "Canvas" } }));
      h.state.dispatch(setPreviewOpen({ ownerKey: owner, open }));
    });
    act(() => h.source.emit(CHANNELS.runs.pullRequestCreated, event));
    const state = h.state.getState();
    expect(state.preview.byOwner[owner]).toMatchObject({ open, activeTabId: "canvas" });
    expect(state.preview.byOwner[owner].tabs).toHaveLength(2);
    expect(state.workspace.activeTab).toBe("run-b");
    expect(state.appSettings.sessionPanelOpen).toBe(true);
    expect(state.appSettings.rightPanelOpen).toBe(true);
  });

  it("adds a background workspace's PR without revealing its panel", () => {
    const h = harness();
    act(() => h.source.emit(CHANNELS.runs.pullRequestCreated, { ...event, runId: "elsewhere", workspaceId: "other-ws" }));
    const state = h.state.getState();
    expect(state.preview.byOwner[workspaceBrowserExpansionKey(null, "other-ws")]).toMatchObject({ open: false });
    expect(state.preview.byOwner[owner]).toBeUndefined();
    expect(state.workspace.activeWorkspaceId).toBe("ws");
  });

  it.each(["work", "chat"] as const)("keeps %s PRs with their own conversation", (mode) => {
    const h = harness("/code/runs/run-b");
    act(() => h.state.dispatch(setComposerContextKey(runOwnerKey(null, "run-b"))));
    act(() => h.source.emit(CHANNELS.runs.pullRequestCreated, { ...event, mode, workspaceId: null }));
    expect(h.state.getState().preview.byOwner[runOwnerKey(null, "run-a")]).toMatchObject({ open: false });
    expect(h.state.getState().preview.byOwner[runOwnerKey(null, "run-b")]).toBeUndefined();
  });

  it("opens a visible Work conversation and ignores stale run state on another route", () => {
    const h = harness("/code/runs/run-a");
    act(() => h.source.emit(CHANNELS.runs.pullRequestCreated, { ...event, mode: "work", workspaceId: null }));
    expect(h.state.getState().preview.byOwner[runOwnerKey(null, "run-a")].open).toBe(true);
    act(() => { void h.result.current("/settings"); });
    act(() => h.source.emit(CHANNELS.runs.pullRequestCreated, { ...event, toolCallId: 43, url: "https://github.com/acme/widget/pull/177" }));
    expect(h.state.getState().preview.byOwner[owner].open).toBe(false);
  });

  it("does not reopen a closed PR on duplicate completion or transcript/history refresh", () => {
    const h = harness();
    act(() => h.source.emit(CHANNELS.runs.pullRequestCreated, event));
    act(() => h.state.dispatch(closePreviewTab({ ownerKey: owner, id: "pull-request:github:acme/widget#176" })));
    act(() => {
      h.source.emit(CHANNELS.runs.pullRequestCreated, event);
      h.source.emit(CHANNELS.runs.eventPersisted, { runId: event.runId, ts: Date.now() });
    });
    expect(h.state.getState().preview.byOwner[owner].tabs).toHaveLength(0);
    expect(h.state.getState().preview.byOwner[owner].open).toBe(false);
  });

  it("rejects delayed events from a previous backend and scopes new events to the current backend", () => {
    const h = harness();
    const oldListener = [...h.source.listeners.get(CHANNELS.runs.pullRequestCreated)!][0];
    const remote = fakeTransport();
    act(() => { setTransport(remote.transport); h.state.dispatch(setActiveBackend("remote")); });
    act(() => oldListener(event));
    expect(h.state.getState().preview.byOwner).toEqual({});
    act(() => remote.emit(CHANNELS.runs.pullRequestCreated, event));
    expect(h.state.getState().preview.byOwner[workspaceBrowserExpansionKey("remote", "ws")].tabs).toHaveLength(1);
    expect(h.state.getState().preview.byOwner[owner]).toBeUndefined();
  });
});
