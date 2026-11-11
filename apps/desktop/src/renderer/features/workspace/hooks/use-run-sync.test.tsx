// @vitest-environment jsdom

import { useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { ok } from "@mains/contracts/service-response";
import { resetTransport, setTransport } from "@/lib/transport";
import { baseApi } from "@/lib/redux/api/baseApi";
import { runsApi } from "@/lib/redux/api/runsApi";
import { workspaceApi, type WorkspaceDiff } from "@/lib/redux/api/workspaceApi";
import { useGitActionsPanel } from "../components/session-panel/git-actions/use-git-actions-panel";
import { createRunCache } from "../lib/run-cache";
import type { Run } from "../types";
import { useRunSync } from "./use-run-sync";
import { toast } from "@/components/ui";

vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  resetTransport();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function syncView(invoke: (channel: string, args?: unknown[]) => Promise<any>) {
  const listeners = new Map<string, (payload: unknown) => void>();
  const transport = { kind: "test", invoke, subscribe: (channel: string, callback: (payload: unknown) => void) => {
    listeners.set(channel, callback); return () => { listeners.delete(channel); };
  }, status: () => "connected" as const, onStatusChange: () => () => {} };
  setTransport(transport);
  const store = configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
  const cache = createRunCache(), onRunUpdated = vi.fn(), loadRunDetails = vi.fn().mockResolvedValue(undefined);
  const current: Run = { id: "run", status: "running", goal: "Work", providerId: "codex" };
  const view = renderHook(({ selected, scopeKey }) => useRunSync({ runs: [current, { ...current, id: "other" }], activeRunId: selected, scopeKey, cache, onRunUpdated, loadRunDetails, clearTurnStreams: vi.fn() }), {
    initialProps: { selected: "run", scopeKey: "view" },
    wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
  });
  return { ...view, cache, onRunUpdated, loadRunDetails, transport,
    emit: (status: Run["status"], runId = "run") => listeners.get(CHANNELS.runs.statusChanged)?.({ runId, status }),
    dispose() { view.unmount(); store.dispatch(baseApi.util.resetApiState()); },
  };
}

it("does not let an older terminal response overwrite a newer running observation", async () => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  const lookup = new Promise<ReturnType<typeof ok>>((resolve) => { finish = resolve; });
  const running: Run = { id: "run", status: "running", goal: "New work", providerId: "codex" };
  const invoke = vi.fn().mockImplementationOnce(() => lookup).mockResolvedValue(ok(running));
  const h = syncView(invoke);
  try {
    act(() => { h.emit("failed"); });
    act(() => { h.emit("running"); });
    await waitFor(() => expect(h.onRunUpdated).toHaveBeenCalledWith(running));
    await act(async () => { finish(ok({ ...running, status: "failed", lastError: "Obsolete failure" })); });
    expect(h.onRunUpdated).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  } finally { h.dispose(); }
});

it("keeps one terminal notification when a duplicate push arrives during error diagnosis", async () => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  const history = new Promise<ReturnType<typeof ok>>((resolve) => { finish = resolve; });
  const failed: Run = { id: "run", status: "failed", goal: "Work", providerId: "codex", lastError: "Process exited with code 1" };
  const invoke = vi.fn(async (channel: string) => channel === CHANNELS.runs.getHistory ? history : ok(failed));
  const h = syncView(invoke);
  try {
    await act(async () => { h.emit("failed"); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.runs.getHistory)).toHaveLength(1);
    await act(async () => { h.emit("failed"); });
    await act(async () => { finish(ok({ artifacts: [{ content: "Please run /login" }] })); });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Authentication expired — sign in from the session view", { duration: 8000 });
  } finally { h.dispose(); }
});

it("retires a late error diagnosis when a new execution has already failed", async () => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  const history = new Promise<ReturnType<typeof ok>>((resolve) => { finish = resolve; });
  const run: Run = { id: "run", status: "running", goal: "Work", providerId: "codex" };
  let current = { ...run, status: "failed" as Run["status"], lastError: "Process exited with code 1" };
  const h = syncView(vi.fn(async (channel) => channel === CHANNELS.runs.getHistory ? history : ok(current)));
  try {
    await act(async () => { h.emit("failed"); });
    current = { ...current, status: "running" };
    await act(async () => { h.emit("running"); });
    current = { ...current, status: "failed", lastError: "New failure" };
    await act(async () => { h.emit("failed"); });
    await act(async () => { finish(ok({ artifacts: [{ content: "Please run /login" }] })); });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("New failure", { duration: 5000 });
  } finally { h.dispose(); }
});

it.each(["scope", "transport", "unmount"])("ignores a late terminal lookup after %s retirement", async (retirement) => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  const lookup = new Promise<ReturnType<typeof ok>>((resolve) => { finish = resolve; });
  const h = syncView(vi.fn(() => lookup));
  try {
    act(() => { h.emit("failed"); });
    if (retirement === "scope") h.rerender({ selected: "run", scopeKey: "other-view" });
    else if (retirement === "transport") act(() => { setTransport({ ...h.transport }); setTransport(h.transport); });
    else h.unmount();
    await act(async () => { finish(ok({ id: "run", status: "failed", lastError: "Stale failure" })); });
    expect(h.onRunUpdated).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  } finally { h.dispose(); }
});

it.each(["scope", "transport", "cache reset"])("retires an already pending error diagnosis after %s", async (retirement) => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  const history = new Promise<ReturnType<typeof ok>>((resolve) => { finish = resolve; });
  const h = syncView(vi.fn(() => history));
  try {
    let finalizing!: Promise<void>;
    act(() => { finalizing = h.result.current.finalizeRun({ id: "run", status: "failed", goal: "Work", providerId: "codex", lastError: "Process exited with code 1" }); });
    if (retirement === "scope") h.rerender({ selected: "run", scopeKey: "other-view" });
    else if (retirement === "transport") act(() => { setTransport({ ...h.transport }); setTransport(h.transport); });
    else h.cache.clear();
    await act(async () => { finish(ok({ artifacts: [{ content: "Please run /login" }] })); await finalizing; });
    expect(toast.error).not.toHaveBeenCalled();
  } finally { h.dispose(); }
});

it("reports the failure once even when optional error diagnosis rejects", async () => {
  const failed: Run = { id: "run", status: "failed", goal: "Work", providerId: "codex", lastError: "Process exited with code 1" };
  const h = syncView(vi.fn(async (channel) => {
    if (channel === CHANNELS.runs.getHistory) throw new Error("History unavailable");
    return ok(failed);
  }));
  try {
    await act(async () => { h.emit("failed"); });
    await act(async () => { h.emit("failed"); });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(failed.lastError, { duration: 5000 });
  } finally { h.dispose(); }
});

it("coalesces slow polls and lets a newer push supersede their response", async () => {
  vi.useFakeTimers();
  let finish!: (value: ReturnType<typeof ok>) => void;
  const lookup = new Promise<ReturnType<typeof ok>>((resolve) => { finish = resolve; });
  const running: Run = { id: "run", status: "running", goal: "Work", providerId: "codex" };
  const invoke = vi.fn().mockImplementationOnce(() => lookup).mockResolvedValue(ok(running));
  const h = syncView(invoke);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => { h.emit("running"); });
    await act(async () => { finish(ok({ ...running, status: "failed", lastError: "Old poll" })); });
    expect(h.onRunUpdated).toHaveBeenCalledExactlyOnceWith(running);
    expect(toast.error).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(invoke).toHaveBeenCalledTimes(3);
  } finally { h.dispose(); }
});

it("does not let the previous tab's terminal poll stop the selected tab's timer", async () => {
  vi.useFakeTimers();
  let finish!: (value: ReturnType<typeof ok>) => void;
  const lookup = new Promise<ReturnType<typeof ok>>((resolve) => { finish = resolve; });
  const invoke = vi.fn().mockImplementationOnce(() => lookup).mockResolvedValue(ok({ id: "other", status: "running" }));
  const h = syncView(invoke);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    h.rerender({ selected: "other", scopeKey: "view" });
    await act(async () => { finish(ok({ id: "run", status: "succeeded" })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.runs.getById, ["other"]);
    expect(invoke).toHaveBeenCalledTimes(2);
  } finally { h.dispose(); }
});

describe("native voice transcript and work sync", () => {
  it("settles previews only at a terminal status, marking stopped answers interrupted", () => {
    const current: Run = { id: "run", status: "running", goal: "Stream", providerId: "codex" };
    setTransport({ kind: "test", invoke: async () => ok(current),
      subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} });
    const store = configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer },
      middleware: (defaults) => defaults().concat(baseApi.middleware) });
    const clearTurnStreams = vi.fn();
    const cache = createRunCache();
    const view = renderHook(({ status }: { status: Run["status"] | undefined }) => useRunSync({
      runs: status ? [{ ...current, status }] : [], activeRunId: "run", cache,
      loadRunDetails: vi.fn().mockResolvedValue(undefined), onRunUpdated: vi.fn(), clearTurnStreams,
    }), { initialProps: { status: undefined as Run["status"] | undefined },
      wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider> });
    try {
      view.rerender({ status: "queued" });
      view.rerender({ status: "running" });
      expect(clearTurnStreams).not.toHaveBeenCalled();
      view.rerender({ status: "canceled" });
      expect(clearTurnStreams).toHaveBeenLastCalledWith(true);
      view.rerender({ status: "succeeded" });
      expect(clearTurnStreams).toHaveBeenLastCalledWith(false);
    } finally { view.unmount(); store.dispatch(baseApi.util.resetApiState()); }
  });

  it("catches up immediately after subscribing when the first persisted push preceded run selection", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const current: Run = { id: "new-run-id", status: "running", goal: "Hello", providerId: "cursor" };
    setTransport({ kind: "test", invoke: async () => ok(current),
      subscribe: (channel, listener) => { listeners.set(channel, listener); return () => { listeners.delete(channel); }; },
      status: () => "connected", onStatusChange: () => () => undefined });
    const store = configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
    const cache = createRunCache();
    const loadRunDetails = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(({ selected }: { selected: boolean }) => useRunSync({ runs: selected ? [current] : [],
      activeRunId: selected ? current.id : null, cache, loadRunDetails, onRunUpdated: vi.fn(), clearTurnStreams: vi.fn() }),
    { initialProps: { selected: false }, wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider> });
    try {
      act(() => { listeners.get(CHANNELS.runs.eventPersisted)?.({ runId: current.id }); });
      expect(loadRunDetails).not.toHaveBeenCalled();
      view.rerender({ selected: true });
      expect(loadRunDetails).toHaveBeenCalledExactlyOnceWith(current.id);
      expect(listeners.has(CHANNELS.runs.eventPersisted)).toBe(true);
    } finally { view.unmount(); store.dispatch(baseApi.util.resetApiState()); }
  });

  it("refreshes idle speech and handles each successive work completion once", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    let current: Run = { id: "voice", status: "succeeded", goal: "Existing chat", providerId: "codex" };
    setTransport({
      kind: "test", invoke: async () => ok(current),
      subscribe: (channel, callback) => { listeners.set(channel, callback); return () => { listeners.delete(channel); }; },
      status: () => "connected", onStatusChange: () => () => undefined,
    });
    const store = configureStore({
      reducer: { [baseApi.reducerPath]: baseApi.reducer },
      middleware: (getDefault) => getDefault().concat(baseApi.middleware),
    });
    const cache = createRunCache();
    cache.markFinalized("voice");
    const loadRunDetails = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(() => {
      const [runs, setRuns] = useState([current]);
      return useRunSync({ runs, activeRunId: "voice", cache, loadRunDetails,
        onRunUpdated: (run) => setRuns([run]), clearTurnStreams: vi.fn() });
    }, { wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider> });
    try {
      expect(loadRunDetails).toHaveBeenCalledExactlyOnceWith("voice");
      loadRunDetails.mockClear();
      act(() => { listeners.get(CHANNELS.runs.eventPersisted)?.({ runId: "another" }); });
      expect(loadRunDetails).not.toHaveBeenCalled();
      act(() => { listeners.get(CHANNELS.runs.eventPersisted)?.({ runId: "voice" }); });
      await waitFor(() => expect(loadRunDetails).toHaveBeenCalledExactlyOnceWith("voice"));
      for (let turn = 1; turn <= 2; turn++) {
        await act(async () => {
          current = { ...current, status: "running" };
          listeners.get(CHANNELS.runs.statusChanged)?.({ runId: "voice", status: "running" });
        });
        await waitFor(() => expect(cache.isFinalized("voice")).toBe(false));
        await act(async () => {
          current = { ...current, status: "failed", lastError: `Voice job ${turn} failed` };
          listeners.get(CHANNELS.runs.statusChanged)?.({ runId: "voice", status: "failed" });
        });
        await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(turn));
        await act(async () => { await view.result.current.finalizeRun(current); });
        expect(toast.error).toHaveBeenCalledTimes(turn);
      }
      // Work already completed by the time the running push is re-fetched.
      await act(async () => {
        current = { ...current, status: "failed", lastError: "Short voice job failed" };
        listeners.get(CHANNELS.runs.statusChanged)?.({ runId: "voice", status: "running" });
      });
      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(3));
      await act(async () => { await view.result.current.finalizeRun(current); });
      expect(toast.error).toHaveBeenCalledTimes(3);
    } finally { view.unmount(); store.dispatch(baseApi.util.resetApiState()); }
  });
});

describe("workspace diff updates after turn undo", () => {
  it.each(["run-a", "another-selected-run"])(
    "refreshes the sidebar and panel with a completed run selected (%s)",
    async (activeRunId) => {
      const listeners = new Map<string, Set<(payload: unknown) => void>>();
      let undoCount = 0;
      const diff = (): WorkspaceDiff | null => undoCount === 2 ? null : ({
        id: "diff-a",
        workspaceId: "ws-a",
        runId: "run-a",
        baseRef: "head",
        diffText: undoCount === 0 ? "before undo" : "remaining user edits",
        files: ["a.ts"],
        stats: {
          shortstat: undoCount === 0
            ? "1 file changed, 32 insertions(+), 10 deletions(-)"
            : "1 file changed, 2 insertions(+), 1 deletion(-)",
          files: 1,
        },
        untrackedFiles: [],
        createdAt: 1,
      });
      const invoke = vi.fn(async (channel: string, args: unknown[]) => {
        if (channel === CHANNELS.workspace.getLatestDiffSummary) {
          if (args[0] === "ws-b") return ok(null);
          const current = diff();
          if (!current) return ok(null);
          const { diffText: _diffText, ...summary } = current;
          return ok(summary);
        }
        if (channel === CHANNELS.workspace.getLatestDiff) return ok(diff());
        if (channel === CHANNELS.gitFlow.getStatus) return ok({
          branch: "feature",
          hasUpstream: true,
          hasRemote: true,
          ahead: 0,
          behind: 0,
          changedFiles: undoCount === 2 ? 0 : 1,
          additions: undoCount === 0 ? 32 : undoCount === 1 ? 2 : 0,
          deletions: undoCount === 0 ? 10 : undoCount === 1 ? 1 : 0,
          files: [],
        });
        if (channel === CHANNELS.runTurns.undoChanges) {
          undoCount += 1;
          // The backend recomputes the workspace diff before emitting this,
          // including when undo removes the last working-tree change.
          for (const listener of listeners.get(CHANNELS.runs.diffUpdated) ?? []) {
            listener({ runId: "run-a", workspaceId: "ws-a", ts: undoCount });
          }
          return ok({ undoneAt: undoCount });
        }
        throw new Error(`Unexpected channel: ${channel}`);
      });
      setTransport({
        kind: "test",
        invoke,
        subscribe: (channel, listener) => {
          const callbacks = listeners.get(channel) ?? new Set();
          callbacks.add(listener);
          listeners.set(channel, callbacks);
          return () => { callbacks.delete(listener); };
        },
        status: () => "connected",
        onStatusChange: () => () => undefined,
      });
      const store = configureStore({
        reducer: { [baseApi.reducerPath]: baseApi.reducer },
        middleware: (getDefault) => getDefault().concat(baseApi.middleware),
      });
      const subscriptions = [
        store.dispatch(workspaceApi.endpoints.getLatestWorkspaceDiffSummary.initiate("ws-a")),
        store.dispatch(workspaceApi.endpoints.getLatestWorkspaceDiff.initiate("ws-a")),
        store.dispatch(workspaceApi.endpoints.getLatestWorkspaceDiffSummary.initiate("ws-b")),
      ];
      await Promise.all(subscriptions.map((subscription) => subscription.unwrap()));
      const loadRunDetails = vi.fn();
      const cache = createRunCache();
      const runs: Run[] = [{ id: activeRunId, status: "succeeded", goal: "Done", providerId: "codex" }];
      const deps = { runs, activeRunId, cache, loadRunDetails, onRunUpdated: vi.fn(), clearTurnStreams: vi.fn() };
      const view = renderHook(() => {
        useRunSync(deps);
        return useGitActionsPanel("ws-a");
      }, {
        wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
      });

      try {
        await waitFor(() => expect(view.result.current.additions).toBe(32));
        act(() => view.result.current.toggleSection("changes"));

        await act(async () => {
          await store.dispatch(runsApi.endpoints.undoRunTurnChanges.initiate({ runId: "run-a", turnId: 1 })).unwrap();
        });
        await waitFor(() => {
          const state = store.getState();
          expect(workspaceApi.endpoints.getLatestWorkspaceDiffSummary.select("ws-a")(state).data?.stats?.shortstat)
            .toBe("1 file changed, 2 insertions(+), 1 deletion(-)");
          expect(workspaceApi.endpoints.getLatestWorkspaceDiff.select("ws-a")(state).data?.diffText)
            .toBe("remaining user edits");
          expect(view.result.current.additions).toBe(2);
          expect(view.result.current.deletions).toBe(1);
        });

        await act(async () => {
          await store.dispatch(runsApi.endpoints.undoRunTurnChanges.initiate({ runId: "run-a", turnId: 2 })).unwrap();
        });
        await waitFor(() => {
          const state = store.getState();
          expect(workspaceApi.endpoints.getLatestWorkspaceDiffSummary.select("ws-a")(state).data).toBeNull();
          expect(workspaceApi.endpoints.getLatestWorkspaceDiff.select("ws-a")(state).data).toBeNull();
          expect(view.result.current.hasChanges).toBe(false);
          expect(view.result.current.additions).toBe(0);
          expect(view.result.current.deletions).toBe(0);
          expect(view.result.current.isSectionOpen("changes")).toBe(false);
        });
        expect(invoke.mock.calls.filter(([channel, args]) =>
          channel === CHANNELS.workspace.getLatestDiffSummary && args[0] === "ws-b",
        )).toHaveLength(1);
        expect(loadRunDetails).toHaveBeenCalledExactlyOnceWith(activeRunId);
      } finally {
        view.unmount();
        subscriptions.forEach((subscription) => subscription.unsubscribe());
        store.dispatch(baseApi.util.resetApiState());
      }
    },
  );
});
