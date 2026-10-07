// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRunCache } from "../lib/run-cache";
const { getHistory } = vi.hoisted(() => ({ getHistory: vi.fn() }));
vi.mock("@/lib/transport", () => ({ appApi: { runs: { getHistory } } }));
import { useRunHistory } from "./use-run-history";

const cursor = (id: number) => ({ timestamp: id * 1000, source: "artifact" as const, id });
function page(first: number, count = 10, end: number | null = null) {
  return { success: true, data: {
    artifacts: Array.from({ length: count }, (_, offset) => ({
      id: first + offset, runId: "r", kind: "report", content: `message-${first + offset}`, createdAt: new Date((first + offset) * 1000),
    })), toolCalls: [], turns: [], start: cursor(first), end: end == null ? null : cursor(end),
    last: cursor(99), hasOlder: first > 0, hasNewer: end != null,
  } };
}
beforeEach(() => getHistory.mockReset());

describe("bounded transcript cache", () => {
  it("invalidates a saved viewport when an evicted run opens a fresh latest page", async () => {
    getHistory.mockResolvedValue(page(90));
    const cache = createRunCache();
    const view = renderHook(() => useRunHistory(cache, "r"));
    await act(() => view.result.current.load("r"));
    const first = view.result.current.history.latestRevision;
    for (const id of ["a", "b", "c", "d"]) await act(() => view.result.current.load(id));
    expect(view.result.current.runEvents.r).toBeUndefined();
    await act(() => view.result.current.load("r"));
    expect(view.result.current.history.latestRevision).not.toBe(first);
  });
  it("opens the latest page and replaces the window instead of accumulating older pages", async () => {
    getHistory.mockResolvedValueOnce(page(90)).mockResolvedValueOnce(page(80, 20)).mockResolvedValueOnce(page(70, 30)).mockResolvedValueOnce(page(60, 30, 90));
    const cache = createRunCache();
    const view = renderHook(() => useRunHistory(cache, "r"));
    await act(() => view.result.current.load("r"));
    expect(getHistory.mock.calls[0][0]).toEqual({ runId: "r", direction: "latest", deferToolOutput: true });
    for (let i = 0; i < 3; i++) await act(() => view.result.current.history.loadOlder());
    expect(view.result.current.runEvents.r).toHaveLength(30);
    expect(view.result.current.runEvents.r[0].content).toBe("message-60");
    expect(view.result.current.runEvents.r.at(-1)?.content).toBe("message-89");
    expect(view.result.current.history.historical).toBe(true);
  });

  it("refreshes the frozen reading window and can return directly to the latest page", async () => {
    getHistory.mockResolvedValue(page(90));
    const cache = createRunCache();
    const view = renderHook(() => useRunHistory(cache, "r"));
    await act(() => view.result.current.load("r"));
    act(() => view.result.current.history.setFollowing(false));
    await act(() => view.result.current.load("r"));
    expect(getHistory.mock.calls[1][0]).toMatchObject({ direction: "refresh", cursor: cursor(90), end: { timestamp: 99000, source: "artifact", id: 100 } });
    act(() => view.result.current.history.setFollowing(true));
    await act(() => view.result.current.history.loadLatest());
    expect(getHistory.mock.calls.at(-1)?.[0]).toEqual({ runId: "r", direction: "latest", deferToolOutput: true });
    expect(view.result.current.history.historical).toBe(false);
  });

  it("serializes paging behind an in-flight refresh", async () => {
    getHistory.mockResolvedValueOnce(page(90));
    const cache = createRunCache();
    const view = renderHook(() => useRunHistory(cache, "r"));
    await act(() => view.result.current.load("r"));
    let finish!: (value: ReturnType<typeof page>) => void;
    getHistory.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(page(80, 20));
    let refreshing!: Promise<void>, paging!: Promise<void>;
    await act(async () => {
      refreshing = view.result.current.load("r");
      paging = view.result.current.history.loadOlder();
      await Promise.resolve();
    });
    expect(getHistory).toHaveBeenCalledTimes(2);
    await act(async () => { finish(page(90)); await refreshing; await paging; });
    expect(getHistory.mock.calls[2][0]).toMatchObject({ direction: "older", cursor: cursor(90) });
    expect(view.result.current.runEvents.r[0].content).toBe("message-80");
  });

  it("ignores responses after the view is cleared and retains errors for retry", async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    getHistory.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const cache = createRunCache();
    const view = renderHook(() => useRunHistory(cache, "r"));
    let loading!: Promise<void>;
    await act(async () => { loading = view.result.current.load("r"); await Promise.resolve(); });
    act(() => view.result.current.clear());
    await act(async () => { finish(page(90)); await loading; });
    expect(view.result.current.runEvents).toEqual({});
    getHistory.mockResolvedValueOnce({ success: false, error: "offline" }).mockResolvedValueOnce(page(90));
    await act(() => view.result.current.load("r"));
    expect(view.result.current.history.error).toBe("offline");
    await act(() => view.result.current.history.loadLatest());
    expect(view.result.current.history.error).toBeNull();
    expect(view.result.current.runEvents.r).toHaveLength(10);
  });
});
