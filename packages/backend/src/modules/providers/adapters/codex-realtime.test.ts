import { describe, expect, it, vi } from "vitest";
import type { RunRealtimeEvent } from "@mains/contracts/realtime";
import type { RealtimeWorkHandlers, WorkRunRealtimeRequest } from "../../../../shared/adapter.types";
import type { CodexRunCoordinator } from "./codex-run-coordinator";
import type { CodexSessionAcquisition } from "./codex-session-acquisition";
import { createCodexRealtime } from "./codex-realtime";

function setup(getVoice?: () => string | undefined) {
  const server = { isRunning: true, sendRequest: vi.fn().mockResolvedValue({}) };
  const release = vi.fn();
  const runs = { watchRealtimeRun: vi.fn((_runId: string, _model: string | undefined, _work: RealtimeWorkHandlers, _prompt?: () => string) => release), cleanupRun: vi.fn().mockResolvedValue(undefined) };
  const sessions = { prepareRealtimeSession: vi.fn().mockResolvedValue({ server, threadId: "thread", model: "resolved" }) };
  const native = createCodexRealtime({ runs: runs as unknown as CodexRunCoordinator, sessions: sessions as unknown as CodexSessionAcquisition, getVoice });
  const events: RunRealtimeEvent[] = [];
  const work: RealtimeWorkHandlers = { onTurnStarted: vi.fn().mockResolvedValue(undefined), onEvent: vi.fn().mockResolvedValue(undefined), onCompleted: vi.fn().mockResolvedValue(undefined) };
  const request: WorkRunRealtimeRequest = { runId: "run", accountId: "account", connectionId: "connection", sdp: "offer", execution: { cwd: "/tmp", workspaceId: null } };
  const start = (id = "connection") => native.start({ ...request, connectionId: id }, (event) => events.push(event), work);
  const notify = (method: string, params: Record<string, unknown>) => native.handleNotification(method, { threadId: "thread", ...params });
  return { native, events, server, runs, sessions, request, work, release, start, notify };
}

describe("Codex native voice signaling", () => {
  it("reads the current voice for each new call and leaves the active call unchanged", async () => {
    let voice = "maple";
    const h = setup(() => voice);
    await h.start();
    expect(h.server.sendRequest).toHaveBeenCalledWith("thread/realtime/start", expect.objectContaining({ voice: "maple" }));
    voice = "ember";
    expect(h.server.sendRequest).toHaveBeenCalledOnce();
    await h.native.stop("run", "connection");
    await h.start("next");
    expect(h.server.sendRequest).toHaveBeenLastCalledWith("thread/realtime/start", expect.objectContaining({ voice: "ember" }));
    await h.native.stop("run", "next");
  });

  it("surfaces a native voice rejection and releases the prepared session", async () => {
    const h = setup(() => "unsupported-voice");
    const dispose = vi.fn().mockResolvedValue(undefined);
    h.sessions.prepareRealtimeSession.mockResolvedValue({ server: h.server, threadId: "thread", model: "resolved", dispose } as never);
    h.server.sendRequest.mockRejectedValueOnce(new Error("Voice is not supported for v3"));
    await expect(h.start()).rejects.toThrow("Voice is not supported for v3");
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.runs.cleanupRun).toHaveBeenCalledOnce();
    expect(h.events.at(-1)).toMatchObject({ type: "closed", reason: "start_failed" });
  });

  it("cleans up its session-scoped bridge before confirming voice closure", async () => {
    const h = setup();
    let releaseBridge!: () => void;
    const dispose = vi.fn(() => new Promise<void>((resolve) => { releaseBridge = resolve; }));
    h.sessions.prepareRealtimeSession.mockResolvedValue({ server: h.server, threadId: "thread", model: "resolved", dispose } as never);
    await h.start();
    const stopped = h.native.stop("run", "connection");
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(h.events.some((event) => event.type === "closed")).toBe(false);
    releaseBridge(); await stopped;
    expect(h.events.at(-1)).toMatchObject({ type: "closed" });
    await h.native.stop("run", "connection");
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("uses v3 WebRTC with server-owned work, without starting a text turn", async () => {
    const h = setup();
    await h.start();
    expect(h.server.sendRequest).toHaveBeenCalledExactlyOnceWith("thread/realtime/start", {
      threadId: "thread", outputModality: "audio", version: "v3",
      transport: { type: "webrtc", sdp: "offer" }, clientManagedHandoffs: false,
      includeStartupContext: true, flushTranscriptTailOnSessionEnd: false,
    });
    h.notify("thread/realtime/started", { realtimeSessionId: "native" });
    h.notify("thread/realtime/sdp", { sdp: "answer" });
    h.notify("thread/realtime/transcript/delta", { role: "user", delta: "hel" });
    h.notify("thread/realtime/transcript/delta", { role: "user", delta: "lo" });
    h.notify("thread/realtime/transcript/done", { role: "user", text: "hello" });
    const transcripts = h.events.filter((event) => event.type === "transcript");
    expect(transcripts.map((event) => event.text)).toEqual(["hel", "hello", "hello"]);
    expect(new Set(transcripts.map((event) => event.itemId)).size).toBe(1);
    expect(h.runs.watchRealtimeRun.mock.calls[0][3]?.()).toBe("hello");
    expect(h.events).toContainEqual({ runId: "run", connectionId: "connection", type: "sdp", sdp: "answer" });
    await h.native.stop("run", "connection");
    expect(h.server.sendRequest).toHaveBeenLastCalledWith("thread/realtime/stop", { threadId: "thread" });
    expect(h.release).toHaveBeenCalledOnce();
  });

  it("uses canonical transcript identity and avoids duplicate legacy final events", async () => {
    const h = setup();
    await h.start();
    const item = { type: "transcriptSegment", id: "item", role: "assistant", text: "Hi", realtimeSessionId: "native" };
    h.notify("thread/realtime/item/started", { item });
    h.notify("thread/realtime/item/transcript/delta", { itemId: "item", delta: " there" });
    h.notify("thread/realtime/transcript/done", { role: "assistant", text: "Hi there" });
    h.notify("thread/realtime/item/completed", { item: { ...item, text: "Hi there" } });
    expect(h.events.filter((event) => event.type === "transcript")).toMatchObject([
      { itemId: "item", text: "Hi", final: false },
      { itemId: "item", text: "Hi there", final: false },
      { itemId: "item", text: "Hi there", final: true },
    ]);
    await h.native.stop("run", "connection");
  });

  it("keeps handoff speech and ignores another thread or a stale stop", async () => {
    const h = setup();
    await h.start();
    h.notify("thread/realtime/itemAdded", { item: { type: "handoff_request", input_transcript: "Calculate this" } });
    expect(h.runs.watchRealtimeRun.mock.calls[0][3]?.()).toBe("Calculate this");
    h.notify("thread/realtime/error", { threadId: "another", message: "other thread" });
    await h.native.stop("run", "old-connection");
    expect(h.events).toEqual([]);
    expect(h.server.sendRequest).toHaveBeenCalledOnce();
    await h.native.stop("run", "connection");
    await h.start("new-connection");
    await h.native.stop("run", "connection");
    expect(h.release).toHaveBeenCalledOnce();
    await h.native.stop("run", "new-connection");
    expect(h.release).toHaveBeenCalledTimes(2);
  });

  it.each(["error", "disconnect"])("releases work ownership and closes on %s", async (failure) => {
    const h = setup();
    await h.start();
    if (failure === "error") h.notify("thread/realtime/error", { message: "Voice unavailable" });
    else { h.server.isRunning = false; h.native.serverClosed(); }
    await vi.waitFor(() => expect(h.release).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(h.events.map((event) => event.type)).toEqual(["error", "closed"]));
    expect(h.runs.cleanupRun).toHaveBeenCalledWith(h.server, "run");
  });

  it("serializes a canceled preparation before a new call can own the thread", async () => {
    const h = setup();
    let resume!: (value: unknown) => void;
    h.sessions.prepareRealtimeSession.mockReturnValueOnce(new Promise((resolve) => { resume = resolve; }));
    const first = h.start();
    await vi.waitFor(() => expect(h.sessions.prepareRealtimeSession).toHaveBeenCalledOnce());
    const stopping = h.native.stop("run", "connection");
    // Keep the service's claim until canceled preparation is quiescent.
    expect(h.events).toEqual([]);
    expect(h.sessions.prepareRealtimeSession).toHaveBeenCalledOnce();
    resume({ server: h.server, threadId: "thread", model: "resolved" });
    await Promise.all([first, stopping]);
    await h.start("next");
    expect(h.sessions.prepareRealtimeSession).toHaveBeenCalledTimes(2);
    expect(h.server.sendRequest).toHaveBeenCalledOnce();
    await h.native.stop("run", "next");
  });

  it("deduplicates pending stops and never sends an old stop after a new call owns the thread", async () => {
    const h = setup();
    let accept!: (value: unknown) => void;
    h.server.sendRequest.mockReturnValueOnce(new Promise((resolve) => { accept = resolve; }));
    const first = h.start();
    await vi.waitFor(() => expect(h.server.sendRequest).toHaveBeenCalledOnce());
    const stops = [h.native.stop("run", "connection"), h.native.stop("run", "connection")];
    h.notify("thread/realtime/closed", { reason: "connection ended" });
    const next = h.start("next");
    accept({});
    await Promise.all([first, next, ...stops]);
    expect(h.server.sendRequest.mock.calls.map(([method]) => method)).toEqual(["thread/realtime/start", "thread/realtime/start"]);
    await h.native.stop("run", "next");
    expect(h.server.sendRequest).toHaveBeenCalledTimes(3);
    expect(h.release).toHaveBeenCalledTimes(2);
  });

  it("publishes closed only after unsubscribe, before another call resumes the thread", async () => {
    const h = setup();
    let unsubscribed!: () => void;
    h.runs.cleanupRun.mockReturnValueOnce(new Promise<void>((resolve) => { unsubscribed = resolve; }));
    await h.start();
    const stopping = h.native.stop("run", "connection");
    await vi.waitFor(() => expect(h.runs.cleanupRun).toHaveBeenCalledOnce());
    expect(h.events.filter((event) => event.type === "closed")).toHaveLength(0);
    const next = h.start("next");
    expect(h.sessions.prepareRealtimeSession).toHaveBeenCalledOnce();
    unsubscribed();
    await Promise.all([stopping, next]);
    expect(h.events).toContainEqual({ runId: "run", connectionId: "connection", type: "closed", reason: "ended" });
    expect(h.sessions.prepareRealtimeSession).toHaveBeenCalledTimes(2);
    await h.native.stop("run", "next");
  });

  it("retains native ownership after a rejected stop so closure can be retried", async () => {
    const h = setup();
    await h.start();
    h.server.sendRequest.mockRejectedValueOnce(new Error("Stop was rejected"));
    await expect(h.native.stop("run", "connection")).rejects.toThrow("Stop was rejected");
    expect(h.events.filter((event) => event.type === "closed")).toEqual([]);
    expect(h.release).not.toHaveBeenCalled();
    expect(h.runs.cleanupRun).not.toHaveBeenCalled();
    await expect(h.start("next")).rejects.toThrow("End the current voice chat");
    await h.native.stop("run", "connection");
    expect(h.server.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      "thread/realtime/start", "thread/realtime/stop", "thread/realtime/stop",
    ]);
    expect(h.events).toContainEqual({ runId: "run", connectionId: "connection", type: "closed", reason: "ended" });
    expect(h.release).toHaveBeenCalledOnce();
    await h.start("next");
    await h.native.stop("run", "next");
  });

  it("accepts a native close that arrives while its stop RPC rejects", async () => {
    const h = setup();
    await h.start();
    h.server.sendRequest.mockImplementationOnce(async () => {
      h.notify("thread/realtime/closed", { reason: "ended" });
      throw new Error("Transport closed before response");
    });
    await expect(h.native.stop("run", "connection")).resolves.toBeUndefined();
    expect(h.events.filter((event) => event.type === "closed")).toHaveLength(1);
    expect(h.release).toHaveBeenCalledOnce();
    expect(h.runs.cleanupRun).toHaveBeenCalledOnce();
  });
});
