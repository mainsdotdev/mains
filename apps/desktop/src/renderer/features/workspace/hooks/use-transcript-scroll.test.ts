// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTranscriptScroll } from "./use-transcript-scroll";
import type { RunEvent } from "../types";
import type { TranscriptHistory } from "./use-run-history";
import { createTranscriptViewCache } from "../lib/transcript-view-state";

const events = (first: number, count: number): RunEvent[] => Array.from({ length: count }, (_, offset) => ({
  id: `artifact-${first + offset}`, type: "artifact", timestamp: new Date(), content: "message",
}));
function viewport(ids: string[]) {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", { value: 500 });
  Object.defineProperty(element, "scrollHeight", { get: () => element.children.length * 100 });
  const mount = (keys: string[]) => {
    element.replaceChildren(...keys.map((id, index) => {
      const row = document.createElement("div");
      row.dataset.historyId = id;
      row.getBoundingClientRect = () => ({ top: index * 100 - element.scrollTop, bottom: (index + 1) * 100 - element.scrollTop } as DOMRect);
      return row;
    }));
  };
  mount(ids);
  return { element, mount };
}
const controls = (): TranscriptHistory => ({ hasOlder: true, hasNewer: false, following: true, historical: false, latestRevision: 1,
  loading: false, error: null, loadOlder: vi.fn(async () => {}), loadNewer: vi.fn(async () => {}),
  loadLatest: vi.fn(async () => {}), retry: vi.fn(async () => {}), setFollowing: vi.fn(),
});

describe("transcript scroll", () => {
  it("opening a paused historical window preserves its position instead of landing at its local tail", () => {
    const initial = events(20, 30), history = { ...controls(), following: false, historical: true, hasNewer: true };
    const { element } = viewport(initial.map((event) => event.id));
    element.scrollTop = 250;
    const view = renderHook(({ messages }) => useTranscriptScroll("r", messages, true, history), { initialProps: { messages: initial } });
    act(() => { view.result.current.container.current = element; });
    view.rerender({ messages: [...initial] });
    expect(element.scrollTop).toBe(250);
    view.unmount();
  });

  it("moving down near the top cannot automatically page backward", () => {
    const initial = events(20, 30), history = { ...controls(), hasOlder: false };
    const { element } = viewport(initial.map((event) => event.id));
    const view = renderHook(({ messages }) => useTranscriptScroll("r", messages, true, history), { initialProps: { messages: initial } });
    act(() => { view.result.current.container.current = element; });
    view.rerender({ messages: [...initial] });
    element.scrollTop = 100; act(() => view.result.current.onScroll());
    history.hasOlder = true;
    element.scrollTop = 150; act(() => view.result.current.onScroll());
    expect(history.loadOlder).not.toHaveBeenCalled();
    view.unmount();
  });

  it("content resize cannot chase the old page while latest is loading or after its failure", async () => {
    const initial = events(20, 30), history = controls();
    let fail!: (error: Error) => void, resize!: FrameRequestCallback;
    history.loadLatest = vi.fn(() => new Promise<void>((_, reject) => { fail = reject; }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { resize = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      const { element } = viewport(initial.map((event) => event.id));
      const view = renderHook(({ messages }) => useTranscriptScroll("r", messages, true, history), { initialProps: { messages: initial } });
      act(() => { view.result.current.container.current = element; });
      view.rerender({ messages: [...initial] });
      element.scrollTop = 250; act(() => view.result.current.onScroll());
      let pending!: Promise<void>;
      act(() => { pending = view.result.current.page("latest"); view.result.current.onResize(); resize(0); });
      expect(element.scrollTop).toBe(250);
      await act(async () => { fail(new Error("offline")); await pending; });
      expect(element.scrollTop).toBe(250);
      expect(history.setFollowing).toHaveBeenLastCalledWith(false);
      view.unmount();
    } finally { vi.unstubAllGlobals(); }
  });
  it("a pending page in the previous conversation cannot block or unlock the replacement", async () => {
    const initial = events(20, 30);
    const first = controls(), second = controls();
    let finishFirst!: () => void, finishSecond!: () => void;
    first.loadOlder = vi.fn(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    second.loadOlder = vi.fn(() => new Promise<void>((resolve) => { finishSecond = resolve; }));
    const { element } = viewport(initial.map((event) => event.id));
    const view = renderHook(({ runId, history }) => useTranscriptScroll(runId, initial, true, history),
      { initialProps: { runId: "first", history: first } });
    act(() => { view.result.current.container.current = element; });
    view.rerender({ runId: "first", history: first });
    let pendingFirst!: Promise<void>, pendingSecond!: Promise<void>;
    act(() => { pendingFirst = view.result.current.page("older"); });
    view.rerender({ runId: "second", history: second });
    act(() => { pendingSecond = view.result.current.page("older"); });
    expect(second.loadOlder).toHaveBeenCalledTimes(1);
    await act(async () => { finishFirst(); await pendingFirst; });
    await act(() => view.result.current.page("older"));
    expect(second.loadOlder).toHaveBeenCalledTimes(1);
    await act(async () => { finishSecond(); await pendingSecond; });
    view.unmount();
  });
  it("preserves the visible message when older rows prepend and the far end is trimmed", async () => {
    const initial = events(20, 30);
    const history = controls();
    const { element, mount } = viewport(initial.map((event) => event.id));
    const view = renderHook(({ messages }) => useTranscriptScroll("r", messages, true, history), { initialProps: { messages: initial } });
    act(() => { view.result.current.container.current = element; });
    view.rerender({ messages: [...initial] });
    element.scrollTop = 250;
    act(() => view.result.current.onScroll());
    await act(() => view.result.current.page("older"));
    const older = events(10, 30);
    mount(older.map((event) => event.id));
    view.rerender({ messages: older });
    expect(element.scrollTop).toBe(1250);
    expect(history.loadOlder).toHaveBeenCalledTimes(1);
    expect(history.setFollowing).toHaveBeenCalledWith(false);
  });

  it("holds still for live updates while reading and jumps when latest is requested", () => {
    const initial = events(20, 10);
    let history = controls();
    const { element, mount } = viewport(initial.map((event) => event.id));
    const view = renderHook(({ messages }) => useTranscriptScroll("r", messages, true, history), { initialProps: { messages: initial } });
    act(() => { view.result.current.container.current = element; });
    view.rerender({ messages: [...initial] });
    element.scrollTop = 250;
    act(() => view.result.current.onScroll());
    const grown = events(20, 15);
    mount(grown.map((event) => event.id));
    view.rerender({ messages: grown });
    expect(element.scrollTop).toBe(250);
    history = { ...history, latestRevision: 2 };
    view.rerender({ messages: grown });
    expect(element.scrollTop).toBe(element.scrollHeight);
  });

  it("restores reading position when the transcript is unmounted for another tab", () => {
    const initial = events(20, 30);
    const history = controls();
    const state = createTranscriptViewCache().get("r");
    const { element } = viewport(initial.map((event) => event.id));
    const view = renderHook(({ visible }) => useTranscriptScroll("r", initial, visible, history, state), { initialProps: { visible: true } });
    act(() => { view.result.current.container.current = element; });
    view.rerender({ visible: false });
    view.rerender({ visible: true });
    element.scrollTop = 250;
    act(() => view.result.current.onScroll());
    view.rerender({ visible: false });
    element.scrollTop = 0;
    view.rerender({ visible: true });
    expect(element.scrollTop).toBe(250);
    expect(state.followTail).toBe(false);
  });
});
