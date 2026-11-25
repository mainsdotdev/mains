// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { workspaceApi, type Workspace } from "@/lib/redux/api/workspaceApi";
import { resetTransport, setTransport } from "@/lib/transport/registry";
import type { Transport } from "@/lib/transport/types";
import { useStartupWorkspaceDiffRefresh } from "./use-startup-workspace-diff-refresh";

const readiness = vi.hoisted(() => ({ ready: false, callbacks: new Set<() => void>() }));
vi.mock("@/lib/app-ready", () => ({
  onAppReady(callback: () => void) {
    if (readiness.ready) callback();
    else readiness.callbacks.add(callback);
    return () => readiness.callbacks.delete(callback);
  },
}));

function markReady() {
  readiness.ready = true;
  for (const callback of readiness.callbacks) callback();
  readiness.callbacks.clear();
}

function workspace(id: string, patch: Partial<Workspace> = {}): Workspace {
  return {
    id, accountId: "default", projectId: "project", name: id, rootPath: `/repo/${id}`,
    repoUrl: null, baseBranch: null, metadata: null, status: "todo", isArchived: false,
    sortOrder: 0, pinnedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...patch,
  };
}

function createStore() {
  return configureStore({
    reducer: { [workspaceApi.reducerPath]: workspaceApi.reducer, workspace: (state = { activeWorkspaceId: "selected" }) => state },
    middleware: (defaults) => defaults({ serializableCheck: false }).concat(workspaceApi.middleware),
  });
}

let store: ReturnType<typeof createStore>;
const pending = new Map<string, (result: ServiceResponse<unknown>) => void>();
const workspaces = [
  workspace("one"), workspace("replica", { isReplica: true }), workspace("two"),
  workspace("archived", { isArchived: true }), workspace("selected"),
  workspace("empty", { rootPath: "" }), workspace("three"),
];

const invoke = vi.fn<Transport["invoke"]>(async (channel, args) => {
  if (channel === CHANNELS.workspace.list) return { success: true, data: workspaces };
  if (channel === CHANNELS.workspace.getLatestDiffSummary) return { success: true, data: null };
  if (channel === CHANNELS.workspace.resyncDiff) {
    return new Promise((resolve) => pending.set(String(args?.[0]), resolve));
  }
  throw new Error(`Unexpected channel ${channel}`);
});
const local: Transport = {
  kind: "ipc", invoke, status: () => "connected", subscribe: () => () => {}, onStatusChange: () => () => {},
};

const refreshed = () => invoke.mock.calls
  .filter(([channel]) => channel === CHANNELS.workspace.resyncDiff)
  .map(([, args]) => args?.[0]);
const summaryReads = () => invoke.mock.calls
  .filter(([channel]) => channel === CHANNELS.workspace.getLatestDiffSummary).length;

function Wrapper({ children }: { children: ReactNode }) {
  return <StrictMode><Provider store={store}>{children}</Provider></StrictMode>;
}

beforeEach(async () => {
  readiness.ready = false;
  store = createStore();
  setTransport(local);
  await store.dispatch(workspaceApi.endpoints.listWorkspaces.initiate());
  await store.dispatch(workspaceApi.endpoints.getLatestWorkspaceDiffSummary.initiate("selected"));
});

afterEach(async () => {
  cleanup();
  for (const resolve of pending.values()) resolve({ success: true, data: null });
  pending.clear();
  readiness.callbacks.clear();
  await Promise.resolve();
  store.dispatch(workspaceApi.util.resetApiState());
  resetTransport();
  invoke.mockClear();
});

it("refreshes eligible workspaces after readiness, prioritizing selection with two concurrent jobs", async () => {
  const view = renderHook(({ enabled }) => useStartupWorkspaceDiffRefresh(enabled), {
    initialProps: { enabled: false }, wrapper: Wrapper,
  });
  expect(readiness.callbacks.size).toBe(0);
  view.rerender({ enabled: true });
  expect(refreshed()).toEqual([]);

  markReady();
  await waitFor(() => expect(refreshed()).toEqual(["selected", "one"]));
  await act(async () => pending.get("selected")?.({ success: true, data: null }));
  expect(refreshed()).toEqual(["selected", "one", "two"]);
  expect(summaryReads()).toBe(2);

  await act(async () => pending.get("one")?.({ success: false, error: "No checkout" }));
  expect(refreshed()).toEqual(["selected", "one", "two", "three"]);
  await act(async () => {
    pending.get("two")?.({ success: true, data: null });
    pending.get("three")?.({ success: true, data: null });
  });
  view.rerender({ enabled: false });
  view.rerender({ enabled: true });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(refreshed()).toHaveLength(4);
});

it("retires queued work and old receipts when the active transport changes", async () => {
  markReady();
  renderHook(() => useStartupWorkspaceDiffRefresh(true), { wrapper: Wrapper });
  await waitFor(() => expect(refreshed()).toEqual(["selected", "one"]));

  await act(async () => {
    setTransport({ ...local, kind: "ws" });
    setTransport(local);
    pending.get("selected")?.({ success: true, data: null });
    pending.get("one")?.({ success: true, data: null });
  });

  expect(refreshed()).toEqual(["selected", "one"]);
  expect(summaryReads()).toBe(1);
});
