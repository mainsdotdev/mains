// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { ok } from "@mains/contracts/service-response";
import { getTransport, resetTransport, setTransport, type TransportStatus } from "@/lib/transport";
import { useStreamingEvents } from "./use-streaming-events";
import { useRunActivityLifecycle } from "./use-run-activity";
import { useBackgroundRunActivity } from "./use-background-run-activity";

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let listeners: Map<string, Set<(data: unknown) => void>>;
let transportStatus: TransportStatus;
let statusListeners: Set<(status: TransportStatus) => void>;

beforeEach(() => {
  nextFrame = 0;
  frames = new Map();
  listeners = new Map();
  transportStatus = "connected";
  statusListeners = new Set();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  setTransport({ kind: "test", invoke: async () => ok(undefined), status: () => transportStatus,
    onStatusChange(listener) { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; },
    subscribe(channel, callback) {
      const callbacks = listeners.get(channel) ?? new Set();
      callbacks.add(callback);
      listeners.set(channel, callbacks);
      return () => { callbacks.delete(callback); };
    },
  });
  renderHook(useRunActivityLifecycle);
});

afterEach(() => { cleanup(); resetTransport(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function emit(channel: string, data: unknown) {
  act(() => { for (const listener of listeners.get(channel) ?? []) listener(data); });
}
function snapshot(streamId: string, content: string, voice = true, final = false, runId = "run", ts = 1000) {
  emit(CHANNELS.runs.ephemeralEvent, { runId, ts, event: { type: "artifact", kind: "report", streamId, content,
    metadata: { streamId, voice, realtimeSessionId: "connection", streaming: !final } } });
}
function frame() {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); });
}

function thought(content: string, streamId = "codex-think-run-reason", kind = "thinking", metadata?: Record<string, unknown>) {
  emit(CHANNELS.runs.ephemeralEvent, { runId: "run", ts: 1000, event: { type: "artifact", kind, streamId, content, metadata } });
}

describe("shared foreground activity", () => {
  it("isolates thoughts by conversation and restores the current thought when returning", () => {
    const chat = renderHook(({ runId }) => useStreamingEvents(runId, new Set<string>()), { initialProps: { runId: "run" } });
    thought("First conversation"); frame();
    chat.rerender({ runId: "another" });
    expect(chat.result.current.streamingEvents).toEqual([]);
    emit(CHANNELS.runs.ephemeralEvent, { runId: "another", ts: 2000, event: {
      kind: "thinking", streamId: "another-thought", content: "Second conversation",
    } }); frame();
    expect(chat.result.current.streamingEvents[0].content).toBe("Second conversation");
    chat.rerender({ runId: "run" });
    expect(chat.result.current.streamingEvents[0].content).toBe("First conversation");
  });

  it("carries the dock's current thought into a newly opened chat and back after unmount", () => {
    vi.useFakeTimers();
    const dock = renderHook(() => useBackgroundRunActivity(["run"]));
    thought("**Defining result fields**");
    act(() => vi.advanceTimersByTime(700));
    expect(dock.result.current.run).toBe("Defining result fields");
    const chat = renderHook(() => useStreamingEvents("run", new Set<string>()));
    expect(chat.result.current.streamingEvents).toMatchObject([{ kind: "thinking", content: "**Defining result fields**" }]);
    chat.unmount();
    const reopened = renderHook(() => useStreamingEvents("run", new Set<string>()));
    expect(reopened.result.current.streamingEvents[0].content).toBe("**Defining result fields**");
    thought(""); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(dock.result.current).toEqual({});
    expect(reopened.result.current.streamingEvents).toEqual([]);
  });

  it.each(["succeeded", "failed", "canceled"])("clears both surfaces on %s, ignores late chunks, and reopens on continuation", (status) => {
    vi.useFakeTimers();
    const dock = renderHook(() => useBackgroundRunActivity(["run"]));
    const chat = renderHook(() => useStreamingEvents("run", new Set<string>()));
    thought("Checking exports"); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(dock.result.current.run).toBe("Checking exports");
    emit(CHANNELS.runs.statusChanged, { runId: "run", status, ts: 2000 });
    thought("Late old thought"); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(chat.result.current.streamingEvents).toEqual([]);
    expect(dock.result.current).toEqual({});
    emit(CHANNELS.runs.statusChanged, { runId: "run", status: "running", ts: 3000 });
    thought("Checking the next turn"); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(chat.result.current.streamingEvents[0].content).toBe("Checking the next turn");
    expect(dock.result.current.run).toBe("Checking the next turn");
  });

  it("keeps command progress separate and ignores a retired thought's delayed clear", () => {
    vi.useFakeTimers();
    const dock = renderHook(() => useBackgroundRunActivity(["run"]));
    const chat = renderHook(() => useStreamingEvents("run", new Set<string>()));
    thought("Old thought", "old");
    thought("**New thought**", "new");
    thought("", "old");
    thought("Compiling", "codex-cmd-run", "tool_progress"); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(dock.result.current.run).toBe("New thought");
    expect(chat.result.current.streamingEvents.map((event) => event.kind)).toEqual(["thinking", "tool_progress"]);
    thought("", "new"); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(dock.result.current.run).toBe("Compiling");
    expect(chat.result.current.streamingEvents.map((event) => event.kind)).toEqual(["tool_progress"]);
  });

  it("does not show assistant prose, voice, or subagent thoughts as dock activity", () => {
    vi.useFakeTimers();
    const dock = renderHook(() => useBackgroundRunActivity(["run"]));
    snapshot("reply", "Assistant reply", false);
    snapshot("voice", "Spoken reply");
    thought("Child thought", "child", "thinking", { isFromSubagent: true });
    act(() => vi.advanceTimersByTime(700));
    expect(dock.result.current).toEqual({});
    thought("**Foreground**", "legacy", "report", { source: "agent_thinking_streaming" });
    act(() => vi.advanceTimersByTime(700));
    expect(dock.result.current.run).toBe("Foreground");
  });

  it("clears activity across backend replacement and rejects callbacks from the old backend", () => {
    vi.useFakeTimers();
    const dock = renderHook(() => useBackgroundRunActivity(["run"]));
    const chat = renderHook(() => useStreamingEvents("run", new Set<string>()));
    thought("Old backend thought"); frame();
    act(() => vi.advanceTimersByTime(700));
    const oldListeners = [...listeners.get(CHANNELS.runs.ephemeralEvent)!];
    act(() => setTransport({ ...getTransport() })); frame();
    act(() => {
      for (const listener of oldListeners) listener({ runId: "run", ts: 3000, event: {
        type: "artifact", kind: "thinking", streamId: "late", content: "Leaked old thought",
      } });
      vi.advanceTimersByTime(700);
    });
    expect(chat.result.current.streamingEvents).toEqual([]);
    expect(dock.result.current).toEqual({});
    thought("New backend thought"); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(dock.result.current.run).toBe("New backend thought");
    expect(chat.result.current.streamingEvents[0].content).toBe("New backend thought");
  });

  it("clears both surfaces on disconnect and waits for fresh activity after reconnecting", () => {
    vi.useFakeTimers();
    const dock = renderHook(() => useBackgroundRunActivity(["run"]));
    const chat = renderHook(() => useStreamingEvents("run", new Set<string>()));
    thought("Before disconnect"); frame();
    act(() => vi.advanceTimersByTime(700));
    act(() => {
      transportStatus = "offline";
      for (const listener of statusListeners) listener(transportStatus);
    });
    thought("Ignored while offline"); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(chat.result.current.streamingEvents).toEqual([]);
    expect(dock.result.current).toEqual({});
    act(() => {
      transportStatus = "connected";
      for (const listener of statusListeners) listener(transportStatus);
    }); frame();
    expect(chat.result.current.streamingEvents).toEqual([]);
    thought("Fresh after reconnect"); frame();
    act(() => vi.advanceTimersByTime(700));
    expect(chat.result.current.streamingEvents[0].content).toBe("Fresh after reconnect");
    expect(dock.result.current.run).toBe("Fresh after reconnect");
  });
});

describe("live voice chat streams", () => {
  it("clears the old backend's previews and acknowledgements even when the run id is unchanged", () => {
    const view = renderHook(() => useStreamingEvents("run", new Set<string>()));
    snapshot("old-live", "Old backend", false); frame();
    const old = getTransport();
    act(() => { setTransport({ ...old }); });
    expect(view.result.current.streamingEvents).toEqual([]);
    snapshot("new-live", "New backend", false); frame();
    expect(view.result.current.streamingEvents.map((event) => event.content)).toEqual(["New backend"]);
  });
  it("does not resurrect an acknowledged message when its row leaves the loaded history window", () => {
    const view = renderHook(({ persisted }) => useStreamingEvents("run", persisted), {
      initialProps: { persisted: new Set<string>() },
    });
    snapshot("acknowledged", "Saved reply", false); frame();
    view.rerender({ persisted: new Set(["acknowledged"]) });
    view.rerender({ persisted: new Set<string>() });
    snapshot("acknowledged", "Late saved reply", false); frame();
    expect(view.result.current.streamingEvents).toEqual([]);
  });
  it("replaces snapshots once per frame and retains the beginning of a spoken message", () => {
    const view = renderHook(() => useStreamingEvents("run", new Set<string>()));
    snapshot("speech", "Hel");
    snapshot("speech", "Hello", true, false, "run", 2000);
    snapshot("other", "wrong conversation", true, false, "another");
    expect(view.result.current.streamingEvents).toHaveLength(0);
    frame();
    expect(view.result.current.streamingEvents).toMatchObject([{ content: "Hello", timestamp: 1000 }]);
  });

  it("keeps voice streams when a delegated work turn completes", () => {
    const view = renderHook(() => useStreamingEvents("run", new Set<string>()));
    snapshot("work", "Work in progress", false);
    snapshot("speech", "Still speaking");
    frame();
    act(() => view.result.current.clearTurnStreams());
    expect(view.result.current.streamingEvents).toMatchObject([
      { content: "Work in progress", metadata: { streaming: false } },
      { content: "Still speaking", metadata: { streaming: true } },
    ]);
  });

  it("holds final text through voice closure and drops only that connection's unfinished speech", () => {
    const view = renderHook(() => useStreamingEvents("run", new Set<string>()));
    snapshot("done", "Complete", true, true);
    snapshot("unfinished", "Interrupted");
    snapshot("work", "Work in progress", false);
    frame();
    emit(CHANNELS.runs.realtimeEvent, { runId: "run", connectionId: "old-connection", type: "closed" });
    expect(view.result.current.streamingEvents).toHaveLength(3);
    emit(CHANNELS.runs.realtimeEvent, { runId: "run", connectionId: "connection", type: "closed" });
    expect(view.result.current.streamingEvents.map((event) => event.content)).toEqual(["Complete", "Work in progress"]);
  });

  it("retires a preview only after its persisted identity is acknowledged and ignores late deltas", () => {
    const view = renderHook(({ persisted }) => useStreamingEvents("run", persisted), { initialProps: { persisted: new Set<string>() } });
    snapshot("speech", "Complete", true, true);
    frame();
    view.rerender({ persisted: new Set(["speech"]) });
    expect(view.result.current.streamingEvents).toHaveLength(0);
    snapshot("speech", "Late partial");
    frame();
    expect(view.result.current.streamingEvents).toHaveLength(0);
  });

  it("keeps an interrupted answer while persistence loads, clears status, and ignores late chunks", () => {
    const view = renderHook(({ persisted }) => useStreamingEvents("run", persisted), {
      initialProps: { persisted: new Set<string>() },
    });
    snapshot("answer", "Received answer ".repeat(100), false);
    emit(CHANNELS.runs.ephemeralEvent, { runId: "run", ts: 1000, event: {
      type: "artifact", kind: "report", streamId: "thinking", content: "Thinking",
      metadata: { source: "agent_thinking_streaming" },
    } });
    frame();
    act(() => view.result.current.clearTurnStreams(true));
    expect(view.result.current.streamingEvents).toMatchObject([{
      content: "Received answer ".repeat(100), metadata: { streaming: false, interrupted: true },
    }]);
    snapshot("answer", "Late replacement", false);
    frame();
    expect(view.result.current.streamingEvents[0].content).toBe("Received answer ".repeat(100));
    view.rerender({ persisted: new Set(["answer"]) });
    expect(view.result.current.streamingEvents).toEqual([]);
    snapshot("next-answer", "Next turn", false);
    frame();
    expect(view.result.current.streamingEvents[0].content).toBe("Next turn");
  });

  it("clears pending work and speech when the selected conversation changes", () => {
    const view = renderHook(({ runId }) => useStreamingEvents(runId, new Set<string>()), { initialProps: { runId: "run" } });
    snapshot("speech", "First chat");
    view.rerender({ runId: "another" });
    frame();
    expect(view.result.current.streamingEvents).toHaveLength(0);
    snapshot("other", "Second chat", true, false, "another");
    frame();
    expect(view.result.current.streamingEvents).toMatchObject([{ content: "Second chat" }]);
  });
});
