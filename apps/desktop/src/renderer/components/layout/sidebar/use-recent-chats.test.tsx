// @vitest-environment jsdom

import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { fail, ok } from "@mains/contracts/service-response";
import { baseApi } from "@/lib/redux/api/baseApi";
import { runsApi, type RecentRun } from "@/lib/redux/api/runsApi";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { useRecentChats } from "./use-recent-chats";

vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({ activeSpace: { id: "space", providerId: "claude_code", mode: "work" } }),
}));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: "work" }) }));

function createStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
}

const running: RecentRun = {
  id: "page-chat", accountId: "account", workspaceId: null, collectionId: null,
  spaceId: "space", providerId: "claude_code", mode: "work", model: null,
  title: "Messi Post", goal: "Create a page", status: "running", systemPrompt: null,
  configSnapshot: { atlasPageId: "page" }, toolPolicySnapshot: null,
  startedAt: 1, endedAt: null, lastError: null, sessionId: "session", isArchived: false,
  pinnedAt: null, createdAt: 1, updatedAt: 1,
};

let store: ReturnType<typeof createStore>;
let saved: RecentRun;
let invoke: ReturnType<typeof vi.fn<Transport["invoke"]>>;
let listeners: Map<string, Set<(payload: unknown) => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  store = createStore();
  saved = { ...running };
  listeners = new Map();
  invoke = vi.fn<Transport["invoke"]>(async (channel: string) => {
    if (channel === CHANNELS.account.get) return ok({ id: "account" });
    if (channel === CHANNELS.runs.listRecent) return ok([{ ...saved }]);
    throw new Error(`Unexpected channel: ${channel}`);
  });
  setTransport({
    kind: "test", invoke, status: () => "connected", onStatusChange: () => () => {},
    subscribe: (channel, listener) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
      return () => { listeners.get(channel)!.delete(listener); };
    },
  });
});

afterEach(() => {
  cleanup();
  store.dispatch(baseApi.util.resetApiState());
  resetTransport();
  vi.useRealTimers();
});

function mount() {
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return renderHook(useRecentChats, { wrapper });
}

async function advance(ms = 50) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function finish(notify = true, status: RecentRun["status"] = "succeeded") {
  saved = { ...saved, status, endedAt: 2, updatedAt: 2 };
  if (notify) {
    for (const listener of listeners.get(CHANNELS.runs.statusChanged) ?? []) {
      listener({ runId: saved.id, status: saved.status, ts: 2 });
    }
  }
}

describe("recent Page chat status", () => {
  it.each(["succeeded", "failed", "canceled"] as const)("stops the running indicator on a %s push", async (status) => {
    const view = mount();
    await advance();
    expect(view.result.current.data?.[0].status).toBe("running");
    act(() => finish(true, status));
    await advance();
    expect(view.result.current.data?.[0].status).toBe(status);
  });

  it("refreshes retained running data when returning from Atlas after a missed completion", async () => {
    const beforeAtlas = mount();
    await advance();
    expect(beforeAtlas.result.current.data?.[0].status).toBe("running");
    beforeAtlas.unmount();
    act(() => finish());

    const home = mount();
    await advance();
    expect(home.result.current.data?.[0].status).toBe("succeeded");
  });

  it("recovers a missed completion push while the home list stays mounted", async () => {
    const home = mount();
    await advance();
    act(() => finish(false));
    await advance(10_000);
    expect(home.result.current.data?.[0].status).toBe("succeeded");
  });

  it("updates on completion while an unrelated API request is still pending", async () => {
    const home = mount();
    await advance();
    let resolvePending!: (response: ReturnType<typeof ok<unknown>>) => void;
    const pending = new Promise<ReturnType<typeof ok<unknown>>>((resolve) => { resolvePending = resolve; });
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.runs.getAll) return pending;
      if (channel === CHANNELS.runs.listRecent) return ok([{ ...saved }]);
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const subscription = store.dispatch(runsApi.endpoints.getRuns.initiate());
    act(() => finish());
    await advance();
    const status = home.result.current.data?.[0].status;
    resolvePending(ok([]));
    await advance();
    subscription.unsubscribe();
    expect(status).toBe("succeeded");
  });

  it("retries a failed completion refresh and stops polling once the chat has settled", async () => {
    const home = mount();
    await advance();
    invoke.mockResolvedValueOnce(fail("Temporary read failure"));
    act(() => finish());
    await advance();
    expect(home.result.current.data?.[0].status).toBe("running");
    expect(home.result.current.isError).toBe(true);

    await advance(10_000);
    expect(home.result.current.data?.[0].status).toBe("succeeded");
    const reads = invoke.mock.calls.length;
    await advance(30_000);
    expect(invoke.mock.calls).toHaveLength(reads);
  });

  it("recovers a queued chat without a push and releases its timer and listeners on navigation", async () => {
    saved = { ...saved, status: "queued" };
    const home = mount();
    await advance();
    act(() => finish(false));
    await advance(10_000);
    expect(home.result.current.data?.[0].status).toBe("succeeded");

    act(() => {
      saved = { ...saved, status: "running" };
      for (const listener of listeners.get(CHANNELS.runs.statusChanged) ?? []) {
        listener({ runId: saved.id, status: "running", ts: 3 });
      }
    });
    await advance();
    expect(home.result.current.data?.[0].status).toBe("running");
    home.unmount();
    const reads = invoke.mock.calls.length;
    await advance(30_000);
    expect(invoke.mock.calls).toHaveLength(reads);
    expect(listeners.get(CHANNELS.runs.statusChanged)?.size).toBe(0);
    expect(listeners.get(CHANNELS.runs.updated)?.size).toBe(0);
  });
});
