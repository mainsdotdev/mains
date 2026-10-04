import { afterEach, describe, expect, it, vi } from "vitest";
import { ok, fail } from "@mains/contracts/service-response";
import type { RunRealtimeEvent, RunRealtimeUpdate } from "@mains/contracts/realtime";
import { createRealtimeVoiceController } from "./realtime-voice-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function setup() {
  let listener!: (event: RunRealtimeEvent) => void;
  const track = { enabled: true, onended: null as (() => void) | null, stop: vi.fn(() => track.onended?.()) };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const channel = {
    onclose: null as (() => void) | null, onerror: null as (() => void) | null,
    onopen: null as (() => void) | null, readyState: "connecting", send: vi.fn(),
    close: vi.fn(() => channel.onclose?.()),
  };
  const peer = {
    connectionState: "new", remoteDescription: null as unknown,
    onconnectionstatechange: null as (() => void) | null, ontrack: null as ((event: unknown) => void) | null,
    addTrack: vi.fn(), createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "v=0\r\n" }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn(async (answer) => { peer.remoteDescription = answer; }),
    close: vi.fn(() => { peer.connectionState = "closed"; peer.onconnectionstatechange?.(); }),
  };
  const audio = { autoplay: false, srcObject: null, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };
  const off = vi.fn();
  const api = {
    start: vi.fn().mockResolvedValue(ok(undefined)), stop: vi.fn().mockResolvedValue(ok(undefined)),
    subscribe: vi.fn((callback) => { listener = callback; return off; }),
  };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const createPeer = vi.fn(() => peer as unknown as RTCPeerConnection);
  const audioMeter = {
    setInput: vi.fn(), setOutput: vi.fn(), setMuted: vi.fn(),
    read: vi.fn(() => ({ input: 0.4, output: 0.6 })), dispose: vi.fn(),
  };
  const controller = createRealtimeVoiceController({
    api: () => api, getUserMedia, createPeer,
    createAudio: () => audio as unknown as HTMLAudioElement, createId: () => "connection-a", timeoutMs: 100,
    createAudioMeter: () => audioMeter,
  });
  const input = { runId: "run", accountId: "account", label: "My chat" };
  const emit = (event: RunRealtimeUpdate) => listener({ runId: "run", connectionId: "connection-a", ...event });
  const connected = () => { peer.connectionState = "connected"; peer.onconnectionstatechange?.(); };
  return { controller, input, api, off, track, stream, peer, channel, audio, audioMeter, getUserMedia, createPeer, emit, connected,
    event: (event: RunRealtimeEvent) => listener(event) };
}

afterEach(() => { vi.useRealTimers(); });

describe("native voice media ownership", () => {
  it("turns off the microphone immediately when the model requests closure, retaining retry on a failed native stop", async () => {
    const h = setup(); await h.controller.start(h.input);
    const stopped = deferred<ReturnType<typeof ok<void>>>();
    h.api.stop.mockReturnValue(stopped.promise);
    h.emit({ type: "ending" });
    expect(h.track.stop).toHaveBeenCalledOnce(); expect(h.channel.close).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().phase).toBe("ending");
    stopped.resolve(fail("Closure not confirmed"));
    await vi.waitFor(() => expect(h.controller.getSnapshot().phase).toBe("stop_failed"));
    h.api.stop.mockResolvedValue(ok(undefined));
    await h.controller.stop();
    expect(h.controller.getSnapshot().phase).toBe("idle");
  });
  it("queues verified task updates until the data channel opens, sends them once and rejects stale calls", async () => {
    const h = setup(); await h.controller.start(h.input);
    const progress = { type: "context" as const, eventId: "progress", content: "Worker is checking files", announce: false };
    const result = { type: "context" as const, eventId: "result", content: "Refactor completed; tests passed", announce: true };
    h.emit(progress); h.emit(progress); h.emit(result);
    expect(h.channel.send).not.toHaveBeenCalled();
    h.channel.readyState = "open"; h.channel.onopen?.();
    expect(h.channel.send.mock.calls.map(([text]) => JSON.parse(text))).toEqual([
      { type: "session.context.append", content: [{ type: "input_text", text: progress.content }] },
      { type: "session.context.append", channel: "commentary", content: [{ type: "input_text", text: result.content }] },
    ]);
    h.emit(result);
    h.event({ runId: "another", connectionId: "connection-a", ...result, eventId: "other" });
    expect(h.channel.send).toHaveBeenCalledTimes(2);
    await h.controller.stop();
    h.emit({ ...result, eventId: "late" });
    expect(h.channel.send).toHaveBeenCalledTimes(2);
    expect(h.channel.onopen).toBeNull(); expect(h.track.stop).toHaveBeenCalledOnce();
  });

  it("keeps the call connected when the native v3 endpoint validates a worker progress update", async () => {
    const h = setup(); await h.controller.start(h.input);
    h.emit({ type: "started", sessionId: "native" }); h.connected();
    h.channel.readyState = "open";
    h.channel.send.mockImplementation((raw: string) => {
      const event = JSON.parse(raw);
      if (event.type !== "session.context.append") {
        h.emit({ type: "error", message: `Invalid value: '${event.type}'. Supported values include 'session.context.append'.` });
      } else {
        expect(event.content).toEqual([{ type: "input_text", text: "The worker is waiting for file approval." }]);
      }
    });
    h.emit({ type: "context", eventId: "approval", content: "The worker is waiting for file approval.", announce: false });
    expect(h.controller.getSnapshot().phase).toBe("connected");
    expect(h.track.stop).not.toHaveBeenCalled();
    await h.controller.stop();
  });

  it.each([false, true])("splits native context at UTF-8 boundaries within the 500-byte limit (announce=%s)", async (announce) => {
    const h = setup(); await h.controller.start(h.input);
    h.channel.readyState = "open";
    const content = "İş sürüyor: Türkçe açıklama ve 👩‍💻 görseli. ".repeat(30);
    h.emit({ type: "context", eventId: "long", content, announce });
    const sent = h.channel.send.mock.calls.map(([raw]) => JSON.parse(raw));
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.map((event) => event.content[0].text).join("")).toBe(content);
    for (const event of sent) {
      expect(event.type).toBe("session.context.append");
      expect(event.channel).toBe(announce ? "commentary" : undefined);
      expect(new TextEncoder().encode(event.content[0].text).length).toBeLessThanOrEqual(500);
      expect(event.content[0].text).not.toContain("\uFFFD");
    }
    await h.controller.stop();
  });

  it("drops queued task results when voice ends before signaling is ready", async () => {
    const h = setup(); await h.controller.start(h.input);
    h.emit({ type: "context", eventId: "result", content: "Done", announce: true });
    const open = h.channel.onopen;
    h.emit({ type: "closed", reason: "ended" });
    h.channel.readyState = "open"; open?.();
    expect(h.channel.send).not.toHaveBeenCalled(); expect(h.controller.getSnapshot().phase).toBe("idle");
  });
  it("exposes a stable call identity and start time for the chat view, then clears them on closure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const h = setup();
    await h.controller.start(h.input);
    expect(h.controller.getSnapshot()).toMatchObject({
      phase: "connecting", runId: "run", connectionId: "connection-a", startedAt: 20_000,
    });
    vi.setSystemTime(25_000);
    h.emit({ type: "started", sessionId: "native" });
    h.connected();
    h.emit({ type: "transcript", itemId: "one", role: "assistant", text: "Live reply", final: false });
    expect(h.controller.getSnapshot()).toMatchObject({ phase: "connected", connectionId: "connection-a", startedAt: 20_000 });
    h.emit({ type: "closed", reason: "ended" });
    expect(h.controller.getSnapshot()).toMatchObject({ phase: "idle", runId: null, connectionId: null, startedAt: null });
  });

  it("samples the existing streams without state updates and stops animation analysis before a pending RPC", async () => {
    const h = setup();
    await h.controller.start(h.input);
    expect(h.audioMeter.setInput).toHaveBeenCalledExactlyOnceWith(h.stream);
    expect(h.controller.getAudioLevels(0)).toEqual({ input: 0, output: 0 });
    const remoteStream = { getAudioTracks: () => [] };
    h.peer.ontrack?.({ streams: [remoteStream] });
    expect(h.audio.srcObject).toBe(remoteStream);
    expect(h.audioMeter.setOutput).toHaveBeenCalledExactlyOnceWith(remoteStream);
    h.emit({ type: "started", sessionId: "native" });
    h.connected();
    const changed = vi.fn();
    h.controller.subscribe(changed);
    expect(h.controller.getAudioLevels(16)).toEqual({ input: 0.4, output: 0.6 });
    expect(h.audioMeter.read).toHaveBeenCalledExactlyOnceWith(16);
    expect(changed).not.toHaveBeenCalled();
    h.controller.toggleMute();
    expect(h.audioMeter.setMuted).toHaveBeenCalledExactlyOnceWith(true);
    const ack = deferred<ReturnType<typeof ok<void>>>();
    h.api.stop.mockReturnValueOnce(ack.promise);
    const stopping = h.controller.stop();
    expect(h.audioMeter.dispose).toHaveBeenCalledOnce();
    expect(h.controller.getAudioLevels(32)).toEqual({ input: 0, output: 0 });
    expect(h.audioMeter.read).toHaveBeenCalledOnce();
    ack.resolve(ok(undefined));
    await stopping;
  });

  it("waits for native start and connected media, then mutes and releases everything once", async () => {
    const h = setup();
    await h.controller.start(h.input);
    expect(h.controller.getSnapshot().phase).toBe("connecting");
    h.emit({ type: "started", sessionId: "native" });
    expect(h.controller.getSnapshot().phase).toBe("connecting");
    h.emit({ type: "sdp", sdp: "answer" });
    await vi.waitFor(() => expect(h.peer.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer" }));
    h.connected();
    expect(h.controller.getSnapshot().phase).toBe("connected");
    h.controller.toggleMute();
    expect(h.track.enabled).toBe(false);
    expect(h.controller.getSnapshot().muted).toBe(true);
    h.controller.toggleMute();
    expect(h.track.enabled).toBe(true);
    await h.controller.stop();
    expect(h.controller.getSnapshot().phase).toBe("idle");
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.peer.close).toHaveBeenCalledOnce();
    expect(h.channel.close).toHaveBeenCalledOnce();
    expect(h.audio.pause).toHaveBeenCalledOnce();
    expect(h.off).toHaveBeenCalledOnce();
    expect(h.api.stop).toHaveBeenCalledExactlyOnceWith({ runId: "run", accountId: "account", connectionId: "connection-a" });
  });

  it("stops late microphone permission results without ever starting a call", async () => {
    const h = setup();
    const permission = deferred<MediaStream>();
    h.getUserMedia.mockReturnValue(permission.promise);
    const starting = h.controller.start(h.input);
    await h.controller.stop();
    permission.resolve(h.stream as unknown as MediaStream);
    await starting;
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.createPeer).not.toHaveBeenCalled();
    expect(h.api.start).not.toHaveBeenCalled();
    expect(h.api.stop).not.toHaveBeenCalled();
    expect(h.audioMeter.dispose).toHaveBeenCalledOnce();
    expect(h.audioMeter.setInput).not.toHaveBeenCalled();
  });

  it("keeps a pending stop owned when route and button cleanup happen together", async () => {
    const h = setup();
    const ended = deferred<ReturnType<typeof ok<void>>>();
    await h.controller.start(h.input);
    h.api.stop.mockReturnValue(ended.promise);
    const stopping = h.controller.stop();
    const repeatedStop = h.controller.stop();
    expect(h.controller.getSnapshot().phase).toBe("ending");
    await h.controller.start(h.input);
    expect(h.api.start).toHaveBeenCalledOnce();
    expect(h.track.stop).toHaveBeenCalledOnce();
    ended.resolve(ok(undefined));
    await Promise.all([stopping, repeatedStop]);
    expect(h.api.stop).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().phase).toBe("idle");
  });

  it.each(["response", "transport"])("keeps closure unconfirmed after a %s failure and retries without reopening the mic", async (failure) => {
    const h = setup();
    await h.controller.start(h.input);
    if (failure === "response") h.api.stop.mockResolvedValueOnce(fail("Stop was rejected"));
    else h.api.stop.mockRejectedValueOnce(new Error("Backend disconnected"));
    await h.controller.stop();
    expect(h.controller.getSnapshot()).toMatchObject({ phase: "stop_failed", runId: "run", muted: false });
    expect(h.controller.getSnapshot().error).toContain("microphone is off");
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.peer.close).toHaveBeenCalledOnce();
    expect(h.channel.close).toHaveBeenCalledOnce();
    expect(h.audio.pause).toHaveBeenCalledOnce();
    expect(h.audio.srcObject).toBeNull();
    await h.controller.start(h.input);
    expect(h.api.start).toHaveBeenCalledOnce();
    expect(h.getUserMedia).toHaveBeenCalledOnce();
    await h.controller.stop();
    expect(h.controller.getSnapshot().phase).toBe("idle");
    expect(h.api.stop).toHaveBeenCalledTimes(2);
    expect(h.track.stop).toHaveBeenCalledOnce();
  });

  it("releases media before waiting for a stop acknowledgement and ignores late native events", async () => {
    const h = setup();
    await h.controller.start(h.input);
    const ack = deferred<ReturnType<typeof ok<void>>>();
    h.api.stop.mockReturnValueOnce(ack.promise);
    const stopping = h.controller.stop();
    expect(h.controller.getSnapshot().phase).toBe("ending");
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.peer.connectionState).toBe("closed");
    expect(h.audio.srcObject).toBeNull();
    h.emit({ type: "started", sessionId: "late" });
    h.emit({ type: "transcript", itemId: "late", role: "user", text: "ignored", final: true });
    expect(h.controller.getSnapshot().phase).toBe("ending");
    expect(h.controller.getSnapshot().transcripts).toEqual([]);
    ack.resolve(ok(undefined));
    await stopping;
    expect(h.controller.getSnapshot().phase).toBe("idle");
  });

  it("ignores stale events and closes a start acknowledged after cancellation", async () => {
    const h = setup();
    const ack = deferred<ReturnType<typeof ok<void>>>();
    h.api.start.mockReturnValue(ack.promise);
    const starting = h.controller.start(h.input);
    await vi.waitFor(() => expect(h.api.start).toHaveBeenCalledOnce());
    h.event({ type: "error", message: "stale", runId: "another", connectionId: "connection-a" });
    expect(h.controller.getSnapshot().phase).toBe("connecting");
    await h.controller.stop();
    h.emit({ type: "started", sessionId: "late" });
    ack.resolve(ok(undefined));
    await starting;
    expect(h.controller.getSnapshot().phase).toBe("idle");
    expect(h.api.stop).toHaveBeenCalledTimes(2);
    expect(h.api.stop.mock.calls.every(([key]) => key.connectionId === "connection-a")).toBe(true);
    expect(h.track.stop).toHaveBeenCalledOnce();
  });

  it.each(["disconnect", "channel", "server", "request"])("releases the mic and signaling on %s failure", async (failure) => {
    const h = setup();
    if (failure === "request") h.api.start.mockResolvedValue(fail("Native voice unavailable"));
    await h.controller.start(h.input);
    if (failure === "disconnect") { h.peer.connectionState = "failed"; h.peer.onconnectionstatechange?.(); }
    if (failure === "channel") h.channel.onclose?.();
    if (failure === "server") h.emit({ type: "error", message: "Codex exited" });
    await vi.waitFor(() => expect(h.controller.getSnapshot().phase).toBe("error"));
    expect(h.controller.getSnapshot().error).toBeTruthy();
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.off).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(h.api.stop).toHaveBeenCalledOnce());
  });

  it("retains an unconfirmed stop when a lost media connection also loses the backend", async () => {
    const h = setup();
    await h.controller.start(h.input);
    h.api.stop.mockRejectedValueOnce(new Error("Backend disconnected"));
    h.peer.connectionState = "failed";
    h.peer.onconnectionstatechange?.();
    await vi.waitFor(() => expect(h.controller.getSnapshot().phase).toBe("stop_failed"));
    await h.controller.start(h.input);
    expect(h.api.start).toHaveBeenCalledOnce();
    await h.controller.stop();
    expect(h.controller.getSnapshot().phase).toBe("idle");
    expect(h.track.stop).toHaveBeenCalledOnce();
  });

  it("reports denied mic access without issuing any backend request", async () => {
    const h = setup();
    h.getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await h.controller.start(h.input);
    expect(h.controller.getSnapshot().error).toContain("Allow microphone access");
    expect(h.api.start).not.toHaveBeenCalled();
    expect(h.api.stop).not.toHaveBeenCalled();
  });

  it("times out a signaling-only connection and releases the microphone", async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.controller.start(h.input);
    h.emit({ type: "started", sessionId: "native" });
    await vi.advanceTimersByTimeAsync(100);
    expect(h.controller.getSnapshot().error).toContain("timed out");
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.api.stop).toHaveBeenCalledOnce();
  });

  it("replaces transcript deltas, preserves final text, and bounds the live log", async () => {
    const h = setup();
    await h.controller.start(h.input);
    h.emit({ type: "transcript", itemId: "one", role: "user", text: "hel", final: false });
    h.emit({ type: "transcript", itemId: "one", role: "user", text: "hello", final: true });
    h.emit({ type: "transcript", itemId: "one", role: "user", text: "late", final: false });
    expect(h.controller.getSnapshot().transcripts).toMatchObject([{ itemId: "one", text: "hello", final: true }]);
    for (let i = 0; i < 60; i++) h.emit({ type: "transcript", itemId: `item-${i}`, role: "assistant", text: "speech", final: true });
    expect(h.controller.getSnapshot().transcripts).toHaveLength(50);
    h.emit({ type: "closed", reason: "ended" });
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().phase).toBe("idle");
  });
});
