// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { ok } from "@mains/contracts/service-response";
import { resetTransport, setTransport } from "@/lib/transport";
import { baseApi } from "@/lib/redux/api/baseApi";
import { runsApi } from "@/lib/redux/api/runsApi";
import workspaceReducer, { setActiveTab } from "@/lib/redux/slices/workspaceSlice";
import { useWorkspaceRuns } from "./use-workspace-runs";

vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({
    activeSpaceId: "codex-space",
    activeSpace: { id: "codex-space", providerId: "codex", mode: "work" },
  }),
}));
vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));
// No sidebar listener or provider push is mounted while Atlas creates the run.
vi.mock("./use-run-sync", () => ({ useRunSync: () => ({ finalizeRun: vi.fn() }) }));
vi.mock("./use-streaming-events", () => ({
  useStreamingEvents: () => ({ streamingEvents: [], clearTurnStreams: vi.fn() }),
}));

afterEach(() => { cleanup(); resetTransport(); });

describe("embedded conversation creation and recent chats", () => {
  it.each([false, true])("refreshes a previously loaded chat list without provider events (sidebar mounted=%s)", async (subscribed) => {
    const run = { id: "image-run", accountId: "account", providerId: "codex", mode: "work",
      spaceId: "codex-space", workspaceId: null, collectionId: null, status: "running", goal: "$imagegen A mountain" };
    let created = false;
    setTransport({
      kind: "test",
      invoke: async (channel) => {
        if (channel === CHANNELS.account.get) return ok({ id: "account" });
        if (channel === CHANNELS.runs.listRecent) return ok(created ? [run] : []);
        if (channel === CHANNELS.runs.execute) { created = true; return ok({ runId: run.id }); }
        if (channel === CHANNELS.runs.getById) return ok(run);
        if (channel === CHANNELS.runs.getHistory) return ok({ artifacts: [], toolCalls: [], turns: [],
          start: null, end: null, last: null, hasOlder: false, hasNewer: false });
        throw new Error(`Unexpected channel: ${channel}`);
      },
      subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {},
    });
    const store = configureStore({
      reducer: { [baseApi.reducerPath]: baseApi.reducer, workspace: workspaceReducer },
      middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
    });
    store.dispatch(setActiveTab("existing-chat"));
    const options = { accountId: "account", providerId: "codex", mode: "work" as const };
    const previous = store.dispatch(runsApi.endpoints.listRecentRuns.initiate(options));
    expect(await previous.unwrap()).toEqual([]);
    if (!subscribed) previous.unsubscribe();
    const view = renderHook(() => useWorkspaceRuns(undefined, "codex", "work", undefined, [], { selection: "local" }), {
      wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
    });
    let reopened: ReturnType<typeof previous.refetch> | undefined;
    try {
      await act(async () => {
        expect(await view.result.current.executeRun(run.goal, undefined, "codex")).toBe(run.id);
      });
      reopened = store.dispatch(runsApi.endpoints.listRecentRuns.initiate(options));
      expect((await reopened.unwrap()).map((chat) => chat.id)).toEqual([run.id]);
      expect(store.getState().workspace.activeTab).toBe("existing-chat");
    } finally {
      view.unmount(); previous.unsubscribe(); reopened?.unsubscribe();
      store.dispatch(baseApi.util.resetApiState());
    }
  });
});
