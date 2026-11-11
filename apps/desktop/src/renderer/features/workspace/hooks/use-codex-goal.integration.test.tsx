// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import { getTransport, resetTransport, setTransport, type Transport } from "@/lib/transport";
import { useCodexGoal } from "./use-codex-goal";
import { GoalSummaryBar } from "../components/goal-summary-bar";

const goal = { threadId: "thread-1", objective: "Initial goal", status: "active", updatedAt: 1 };
const invoke = vi.fn();
const events = new Map<string, Set<(payload: any) => void>>();
const stores: ReturnType<typeof makeStore>[] = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
// Keep batched notifications inside the test environment instead of leaving a
// requestAnimationFrame fallback timer behind after jsdom has been torn down.
function makeStore() { return configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware), enhancers: (defaults) => defaults({ autoBatch: { type: "tick" } }) }); }
function harness() {
  const store = makeStore(); stores.push(store);
  return { store, ...renderHook(({ providerId, runId, enabled }) => useCodexGoal(providerId, runId, enabled), {
    initialProps: { providerId: "codex", runId: "run-1", enabled: true }, wrapper: ({ children }: { children: ReactNode }) => <StrictMode><Provider store={store}>{children}</Provider></StrictMode>,
  }) };
}
function push(value: any, runId: string | null = "run-1", providerId = "codex") {
  for (const listener of events.get(CHANNELS.providers.goalUpdated) ?? []) listener({ providerId, runId, goal: value });
}
function renderBar(props: Partial<Parameters<typeof GoalSummaryBar>[0]> = {}) {
  const store = makeStore(); stores.push(store);
  const wrap = (next: typeof props) => <StrictMode><Provider store={store}><GoalSummaryBar providerId="codex" runId="run-1" enabled isRunning={false} {...next} /></Provider></StrictMode>;
  const rendered = render(wrap(props));
  return { ...rendered, replace: (next: typeof props) => rendered.rerender(wrap(next)) };
}
beforeEach(() => {
  invoke.mockImplementation(async (channel) => {
    if (channel === CHANNELS.providers.getGoal) return { success: true, data: goal };
    if (channel === CHANNELS.providers.clearGoal) return { success: true, data: false };
    return { success: true, data: null };
  });
  setTransport({ kind: "test", invoke, status: () => "connected", onStatusChange: () => () => {},
    subscribe: (channel, listener) => {
      const set = events.get(channel) ?? new Set(); set.add(listener); events.set(channel, set);
      return () => { set.delete(listener); };
    } } as Transport);
});
afterEach(() => { cleanup(); for (const store of stores.splice(0)) store.dispatch(baseApi.util.resetApiState()); resetTransport(); events.clear(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("provider goal view through real API endpoints", () => {
  it("shows an unknown provider status without presenting it as active", async () => {
    invoke.mockResolvedValue({ success: true, data: { ...goal, status: "futureState" } });
    renderBar(); await screen.findByText("Goal status: futureState");
    expect(screen.queryByRole("button", { name: "Pause goal" })).toBeNull();
  });
  it("does not recreate a goal through retained edit controls after a provider clear", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    const edit = h.result.current.updateObjective;
    act(() => { push(null); }); invoke.mockClear();
    await act(async () => { expect(await edit("Retired objective")).toBe(false); });
    expect(invoke).not.toHaveBeenCalled(); expect(h.result.current.goal).toBeNull();
  });
  it("ignores uncorrelated, other-run, other-provider and older goal events", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    act(() => {
      push(null, null); push(null, "other-run"); push(null, "run-1", "claude_code");
      push({ ...goal, objective: "Old event", updatedAt: 0 });
      push({ objective: "Malformed" });
    });
    expect(h.result.current.goal?.objective).toBe(goal.objective);
  });
  it.each(["run", "provider", "enabled"])("retires retained controls when the %s scope leaves and returns", async (change) => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    const old = h.result.current;
    h.rerender({ providerId: change === "provider" ? "claude_code" : "codex", runId: change === "run" ? "other-run" : "run-1", enabled: change !== "enabled" });
    h.rerender({ providerId: "codex", runId: "run-1", enabled: true });
    await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    invoke.mockClear();
    await act(async () => { expect(await old.clear()).toBe(false); expect(await old.updateObjective("Old scope")).toBe(false); });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("retires retained controls across backend A → B → A, even with identical run ids", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    const old = h.result.current, transport = getTransport();
    act(() => { setTransport({ ...transport, invoke: vi.fn(async () => ({ success: true, data: { ...goal, objective: "Backend B" } })) } as Transport); });
    await waitFor(() => expect(h.result.current.goal?.objective).toBe("Backend B"));
    act(() => { setTransport(transport); });
    await waitFor(() => expect(h.result.current.goal?.objective).toBe(goal.objective)); invoke.mockClear();
    await act(async () => { expect(await old.clear()).toBe(false); });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("admits only one control action until its provider receipt arrives", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    const receipt = deferred<any>(); invoke.mockImplementation(() => receipt.promise); invoke.mockClear();
    let first!: Promise<boolean>;
    await act(async () => { first = h.result.current.pause(); expect(await h.result.current.clear()).toBe(false); });
    expect(invoke).toHaveBeenCalledOnce(); expect(h.result.current.isBusy).toBe(true);
    await act(async () => { receipt.resolve({ success: true, data: { ...goal, status: "paused" } }); await first; });
    expect(h.result.current.isBusy).toBe(false); expect(h.result.current.goal?.status).toBe("paused");
  });
  it("keeps a newer live goal when an earlier clear is acknowledged", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    const receipt = deferred<any>(); invoke.mockImplementation(() => receipt.promise);
    let clearing!: Promise<boolean>; await act(async () => { clearing = h.result.current.clear(); });
    act(() => { push({ ...goal, objective: "New provider goal", updatedAt: 2 }); });
    await act(async () => { receipt.resolve({ success: true, data: true }); await clearing; });
    expect(h.result.current.goal?.objective).toBe("New provider goal"); expect(h.result.current.isBusy).toBe(false);
  });
  it("discards a mutation receipt after switching runs", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    const receipt = deferred<any>(), original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.providers.setGoal ? receipt.promise : original(channel, args));
    let writing!: Promise<boolean>; await act(async () => { writing = h.result.current.updateObjective("Old run edit"); });
    h.rerender({ providerId: "codex", runId: "run-2", enabled: true });
    await waitFor(() => expect(h.result.current.goal?.objective).toBe(goal.objective));
    await act(async () => { receipt.resolve({ success: true, data: { ...goal, objective: "Old run edit" } }); expect(await writing).toBe(false); });
    expect(h.result.current.goal?.objective).toBe(goal.objective);
  });
  it("retains the goal after a failed mutation and permits an explicit retry", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    invoke.mockResolvedValueOnce({ success: false, error: "Provider unavailable" });
    await act(async () => { expect(await h.result.current.pause()).toBe(false); });
    expect(h.result.current.goal?.status).toBe("active"); expect(h.result.current.isBusy).toBe(false);
    invoke.mockResolvedValueOnce({ success: true, data: { ...goal, status: "paused" } });
    await act(async () => { expect(await h.result.current.pause()).toBe(true); });
    expect(h.result.current.goal?.status).toBe("paused");
  });
  it("tries automatic cleanup once per completion cycle and permits a later completed goal", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    vi.useFakeTimers(); invoke.mockClear();
    act(() => { push({ ...goal, status: "complete", updatedAt: 2 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.clearGoal)).toHaveLength(1);
    expect(h.result.current.goal?.status).toBe("complete");
    act(() => { push({ ...goal, status: "complete", tokensUsed: 7, updatedAt: 3 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.clearGoal)).toHaveLength(1);
    act(() => { push({ ...goal, status: "active", updatedAt: 4 }); push({ ...goal, status: "complete", updatedAt: 5 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.clearGoal)).toHaveLength(2);
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.providers.clearGoal, ["codex", "run-1", "automatic"]);
  });
  it("cancels a completed goal's timer when the provider starts a new goal", async () => {
    const h = harness(); await waitFor(() => expect(h.result.current.goal).not.toBeNull());
    vi.useFakeTimers(); invoke.mockClear();
    act(() => { push({ ...goal, status: "complete", updatedAt: 2 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    act(() => { push({ ...goal, objective: "Next", updatedAt: 3 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(invoke).not.toHaveBeenCalled(); expect(h.result.current.goal?.objective).toBe("Next");
  });
  it("does not submit an unchanged shortened objective", async () => {
    invoke.mockResolvedValue({ success: true, data: { ...goal, objective: "Read @/work/tree/src/index.ts" } });
    renderBar({ rootPath: "/work/tree" }); await screen.findByText("Read @src/index.ts"); invoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" })); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull()); expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects a blank edit and resets the editor when its run is replaced", async () => {
    const h = renderBar(); await screen.findByText(goal.objective);
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    invoke.mockClear(); fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" }); expect(invoke).not.toHaveBeenCalled();
    h.replace({ runId: "run-2" }); await screen.findByText(goal.objective);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("keeps an edited objective open when the provider rejects its update", async () => {
    const store = makeStore(); stores.push(store);
    render(<StrictMode><Provider store={store}><GoalSummaryBar providerId="codex" runId="run-1" enabled isRunning={false} /></Provider></StrictMode>);
    await screen.findByText("Initial goal");
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Goal objective" }), { target: { value: "Keep this edited objective" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CHANNELS.providers.setGoal, ["codex", "run-1", { objective: "Keep this edited objective", origin: "user" }]));
    expect((screen.getByRole("textbox", { name: "Goal objective" }) as HTMLTextAreaElement).value).toBe("Keep this edited objective");
  });
  it("does not overwrite a live goal with an older initial read", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.providers.getGoal ? receipt.promise : original(channel, args));
    const h = harness();
    act(() => { for (const listener of events.get(CHANNELS.providers.goalUpdated) ?? []) listener({ providerId: "codex", runId: "run-1", goal: { ...goal, objective: "Live goal", updatedAt: 2 } }); });
    expect(h.result.current.goal?.objective).toBe("Live goal");
    await act(async () => { receipt.resolve({ success: true, data: goal }); });
    expect(h.result.current.goal?.objective).toBe("Live goal");
  });
  it("retains the goal when native clear returns false", async () => {
    const h = harness();
    await waitFor(() => expect(h.result.current.goal?.objective).toBe("Initial goal"));
    await act(async () => { await h.result.current.clear(); });
    expect(h.result.current.goal?.objective).toBe("Initial goal");
    expect(invoke).toHaveBeenCalledWith(CHANNELS.providers.clearGoal, ["codex", "run-1", "user"]);
  });
});
