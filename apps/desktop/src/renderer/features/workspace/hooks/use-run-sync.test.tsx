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
  vi.clearAllMocks();
});

describe("native voice transcript and work sync", () => {
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
