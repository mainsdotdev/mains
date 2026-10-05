// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { ok } from "@mains/contracts/service-response";
import { resetTransport, setTransport } from "@/lib/transport";
import { useStreamingEvents } from "./use-streaming-events";

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let listeners: Map<string, Set<(data: unknown) => void>>;

beforeEach(() => {
  nextFrame = 0;
  frames = new Map();
  listeners = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  setTransport({ kind: "test", invoke: async () => ok(undefined), status: () => "connected", onStatusChange: () => () => {},
    subscribe(channel, callback) {
      const callbacks = listeners.get(channel) ?? new Set();
      callbacks.add(callback);
      listeners.set(channel, callbacks);
      return () => { callbacks.delete(callback); };
    },
  });
});

afterEach(() => { cleanup(); resetTransport(); vi.unstubAllGlobals(); });

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

describe("live voice chat streams", () => {
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
    expect(view.result.current.streamingEvents.map((event) => event.content)).toEqual(["Still speaking"]);
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
