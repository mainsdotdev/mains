// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalInfo } from "@/lib/redux/api/providersApi";

type GoalUpdate = { providerId: string; runId: string; goal: GoalInfo | null };
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), set: vi.fn(), clear: vi.fn(), listeners: new Set<(event: GoalUpdate) => void>(),
}));
vi.mock("@/lib/redux/api/providersApi", () => ({
  useLazyGetProviderGoalQuery: () => [mocks.fetch],
  useSetProviderGoalMutation: () => [mocks.set, { isLoading: false }],
  useClearProviderGoalMutation: () => [mocks.clear, { isLoading: false }],
}));
vi.mock("@/lib/transport", () => ({ appEvents: { providers: {
  onGoalUpdated: (listener: (event: GoalUpdate) => void) => {
    mocks.listeners.add(listener);
    return () => { mocks.listeners.delete(listener); };
  },
} } }));
import { useCodexGoal } from "./use-codex-goal";

const goal: GoalInfo = { threadId: "thread-1", objective: "Initial goal", status: "active" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReturnValue({ unwrap: async () => goal });
  mocks.set.mockImplementation(({ params }) => ({ unwrap: async () => ({ ...goal, ...params }) }));
  mocks.clear.mockReturnValue({ unwrap: async () => true });
});
afterEach(() => { cleanup(); mocks.listeners.clear(); vi.useRealTimers(); });

describe("Codex goal provenance", () => {
  it("marks edits, pause, resume and explicit removal as user actions", async () => {
    const { result } = renderHook(() => useCodexGoal("codex", "run-1", true));
    await act(async () => { await result.current.updateObjective("Updated goal"); });
    await act(async () => { await result.current.pause(); });
    await act(async () => { await result.current.resume(); });
    await act(async () => { await result.current.clear(); });
    expect(mocks.set.mock.calls.map(([args]) => args)).toEqual([
      { providerId: "codex", runId: "run-1", params: { objective: "Updated goal", origin: "user" } },
      { providerId: "codex", runId: "run-1", params: { status: "paused", origin: "user" } },
      { providerId: "codex", runId: "run-1", params: { status: "active", origin: "user" } },
    ]);
    expect(mocks.clear).toHaveBeenCalledWith({ providerId: "codex", runId: "run-1", origin: "user" });
  });

  it("marks completed-goal cleanup as automatic after the display delay", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCodexGoal("codex", "run-1", true));
    await act(async () => {});
    act(() => { for (const listener of mocks.listeners) listener({ providerId: "codex", runId: "run-1", goal: { ...goal, status: "complete" } }); });
    expect(result.current.goal?.status).toBe("complete");
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(mocks.clear).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.clear).toHaveBeenCalledWith({ providerId: "codex", runId: "run-1", origin: "automatic" });
    expect(result.current.goal).toBeNull();
  });

  it("cancels automatic cleanup when the goal view is disposed", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useCodexGoal("codex", "run-1", true));
    await act(async () => {});
    act(() => { for (const listener of mocks.listeners) listener({ providerId: "codex", runId: "run-1", goal: { ...goal, status: "complete" } }); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
