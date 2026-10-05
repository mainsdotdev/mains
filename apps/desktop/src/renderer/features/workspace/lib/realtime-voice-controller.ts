import type { ConversationSettings } from "@mains/contracts/run-settings";
import type { RunRealtimeEvent, RunRealtimeStartPayload, RunRealtimeStopPayload, RunRealtimeUpdate } from "@mains/contracts/realtime";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { SILENT_VOICE_LEVELS, type RealtimeVoiceAudioMeter } from "./realtime-voice-audio";

export interface VoiceTranscript {
  itemId: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface RealtimeVoiceState {
  phase: "idle" | "connecting" | "connected" | "ending" | "stop_failed" | "error";
  runId: string | null;
  connectionId: string | null;
  startedAt: number | null;
  label: string;
  muted: boolean;
  error: string | null;
  transcripts: VoiceTranscript[];
}

export interface VoiceConnectionApi {
  start(payload: RunRealtimeStartPayload): Promise<ServiceResponse<void>>;
  stop(payload: RunRealtimeStopPayload): Promise<ServiceResponse<void>>;
  subscribe(listener: (event: RunRealtimeEvent) => void): () => void;
}

interface VoiceAttempt {
  key: RunRealtimeStopPayload;
  api: VoiceConnectionApi;
  stream?: MediaStream;
  peer?: RTCPeerConnection;
  audio?: HTMLAudioElement;
  audioMeter?: RealtimeVoiceAudioMeter;
  channel?: RTCDataChannel;
  off?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  issued: boolean;
  serverReady: boolean;
  signalQueue: Promise<void>;
  contextQueue: Array<Extract<RunRealtimeUpdate, { type: "context" }>>;
  contextIds: Set<string>;
}

interface VoiceClosure {
  attempt: VoiceAttempt;
  error?: string;
  request?: Promise<void>;
}

// Codex 0.160's v3 (Frameless Bidi) wire format uses context.append,
// with input_text entries split at 500 UTF-8 bytes, not the public Live API events.
function* nativeContextChunks(content: string) {
  const encoder = new TextEncoder();
  let chunk = "";
  let bytes = 0;
  for (const character of content) {
    const size = encoder.encode(character).length;
    if (bytes + size > 500) {
      yield chunk;
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) yield chunk;
}

const initialState: RealtimeVoiceState = {
  phase: "idle", runId: null, connectionId: null, startedAt: null,
  label: "", muted: false, error: null, transcripts: [],
};

/** App-scoped media owner. Components subscribe; they never own a second mic. */
export function createRealtimeVoiceController(options: {
  api: () => VoiceConnectionApi;
  getUserMedia: () => Promise<MediaStream>;
  createPeer: () => RTCPeerConnection;
  createAudio: () => HTMLAudioElement;
  createAudioMeter?: () => RealtimeVoiceAudioMeter;
  createId: () => string;
  timeoutMs?: number;
}) {
  let state = initialState;
  let active: VoiceAttempt | undefined;
  let closing: VoiceClosure | undefined;
  const listeners = new Set<() => void>();
  function update(patch: Partial<RealtimeVoiceState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function current(attempt: VoiceAttempt) { return active === attempt; }
  function closureFor(attempt: VoiceAttempt) { return closing?.attempt === attempt ? closing : undefined; }
  function mediaReady(attempt: VoiceAttempt) {
    if (!current(attempt) || !attempt.serverReady || attempt.peer?.connectionState !== "connected") return;
    clearTimeout(attempt.timer);
    update({ phase: "connected" });
  }
  function release(attempt: VoiceAttempt) {
    // Retire ownership before close/stop can synchronously fire callbacks.
    if (current(attempt)) active = undefined;
    clearTimeout(attempt.timer);
    attempt.off?.();
    attempt.audioMeter?.dispose();
    attempt.audioMeter = undefined;
    if (attempt.channel) {
      attempt.channel.onopen = null;
      attempt.channel.onclose = null;
      attempt.channel.onerror = null;
      attempt.channel.close();
    }
    attempt.contextQueue.length = 0;
    attempt.contextIds.clear();
    if (attempt.peer) {
      attempt.peer.onconnectionstatechange = null;
      attempt.peer.ontrack = null;
      attempt.peer.close();
    }
    for (const track of attempt.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    if (attempt.audio) { attempt.audio.pause(); attempt.audio.srcObject = null; }
  }
  async function remoteStop(attempt: VoiceAttempt) {
    if (!attempt.issued) return;
    const result = await attempt.api.stop(attempt.key);
    if (!result.success) throw new Error(result.error);
  }
  function confirmClosure(closure: VoiceClosure): Promise<void> {
    return closure.request ??= (async () => {
      try {
        await remoteStop(closure.attempt);
        if (closing !== closure) return;
        closing = undefined;
        if (closure.error) update({ phase: "error", muted: false, error: closure.error });
        else update({ ...initialState });
      } catch (error) {
        if (closing !== closure) return;
        const detail = error instanceof Error ? error.message : String(error);
        update({ phase: "stop_failed", muted: false,
          error: `The microphone is off, but voice chat closure could not be confirmed. Retry ending voice chat. ${detail}` });
      } finally { closure.request = undefined; }
    })();
  }
  function endAttempt(attempt: VoiceAttempt, error?: string) {
    release(attempt);
    const closure = { attempt, error };
    closing = closure;
    update({ phase: "ending", muted: false, error: error ?? null });
    return confirmClosure(closure);
  }
  function fail(attempt: VoiceAttempt, error: unknown) {
    if (!current(attempt)) return;
    const name = error instanceof Error ? error.name : "";
    const message = name === "NotAllowedError"
      ? "Allow microphone access in macOS settings to start voice chat."
      : name === "NotFoundError" ? "No microphone was found."
      : error instanceof Error ? error.message : String(error);
    void endAttempt(attempt, message);
  }
  function handleEvent(attempt: VoiceAttempt, event: RunRealtimeEvent) {
    if (!current(attempt) || event.runId !== attempt.key.runId || event.connectionId !== attempt.key.connectionId) return;
    switch (event.type) {
      case "started":
        attempt.serverReady = true;
        mediaReady(attempt);
        break;
      case "sdp":
        attempt.signalQueue = attempt.signalQueue.then(async () => {
          if (!current(attempt) || !attempt.peer || attempt.peer.remoteDescription) return;
          await attempt.peer.setRemoteDescription({ type: "answer", sdp: event.sdp });
          mediaReady(attempt);
        }).catch((error) => fail(attempt, error));
        break;
      case "transcript": {
        const index = state.transcripts.findIndex((item) => item.itemId === event.itemId);
        const transcripts = [...state.transcripts];
        if (index < 0) transcripts.push(event);
        else if (!transcripts[index].final || event.final) transcripts[index] = event;
        update({ transcripts: transcripts.slice(-50) });
        break;
      }
      case "context":
        if (attempt.contextIds.has(event.eventId)) break;
        attempt.contextIds.add(event.eventId);
        if (attempt.contextIds.size > 256) attempt.contextIds.delete(attempt.contextIds.values().next().value!);
        attempt.contextQueue.push(event);
        if (attempt.contextQueue.length > 32) attempt.contextQueue.shift();
        flushContext(attempt);
        break;
      case "ending": void endAttempt(attempt); break;
      case "error": fail(attempt, new Error(event.message)); break;
      case "closed":
        release(attempt);
        update({ ...initialState });
        break;
    }
  }

  function flushContext(attempt: VoiceAttempt) {
    if (!current(attempt) || attempt.channel?.readyState !== "open") return;
    try {
      while (attempt.contextQueue.length) {
        const event = attempt.contextQueue[0];
        for (const text of nativeContextChunks(event.content)) {
          attempt.channel.send(JSON.stringify({
            type: "session.context.append",
            ...(event.announce ? { channel: "commentary" } : {}),
            content: [{ type: "input_text", text }],
          }));
        }
        attempt.contextQueue.shift();
      }
    } catch (error) { fail(attempt, error); }
  }

  async function start(input: {
    runId: string; accountId: string; label: string; conversationSettings?: ConversationSettings;
  }) {
    if (active || closing) return;
    const attempt: VoiceAttempt = {
      key: { runId: input.runId, accountId: input.accountId, connectionId: options.createId() },
      api: options.api(), issued: false, serverReady: false, signalQueue: Promise.resolve(),
      contextQueue: [], contextIds: new Set(),
    };
    active = attempt;
    update({ ...initialState, phase: "connecting", runId: input.runId, label: input.label,
      connectionId: attempt.key.connectionId, startedAt: Date.now() });
    try {
      // Create/resume Web Audio within the start gesture, before mic permission.
      attempt.audioMeter = options.createAudioMeter?.();
      const stream = await options.getUserMedia();
      if (!current(attempt)) { stream.getTracks().forEach((track) => track.stop()); return; }
      attempt.stream = stream;
      attempt.audioMeter?.setInput(stream);
      const peer = options.createPeer();
      attempt.peer = peer;
      const audio = options.createAudio();
      attempt.audio = audio;
      audio.autoplay = true;
      peer.ontrack = (event) => {
        if (!current(attempt)) return;
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        audio.srcObject = remoteStream;
        attempt.audioMeter?.setOutput(remoteStream);
        void audio.play().catch((error) => fail(attempt, error));
      };
      peer.onconnectionstatechange = () => {
        if (!current(attempt)) return;
        if (peer.connectionState === "failed" || peer.connectionState === "closed" || peer.connectionState === "disconnected") {
          fail(attempt, new Error("Voice connection was lost. Start voice chat again."));
        } else mediaReady(attempt);
      };
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
        track.onended = () => fail(attempt, new Error("The microphone disconnected."));
      }
      // Media travels through WebRTC. The native server handles delegation
      // and transcripts; the data channel keeps the negotiated call complete.
      attempt.channel = peer.createDataChannel("oai-events");
      attempt.channel.onopen = () => flushContext(attempt);
      attempt.channel.onclose = () => fail(attempt, new Error("Voice connection was lost. Start voice chat again."));
      attempt.channel.onerror = () => fail(attempt, new Error("Voice connection failed. Try again."));
      const offer = await peer.createOffer();
      if (!current(attempt)) return;
      if (!offer.sdp) throw new Error("Voice session did not include a connection offer.");
      await peer.setLocalDescription(offer);
      if (!current(attempt)) return;
      attempt.off = attempt.api.subscribe((event) => handleEvent(attempt, event));
      attempt.timer = setTimeout(() => fail(attempt, new Error("Voice connection timed out. Try again.")), options.timeoutMs ?? 25_000);
      attempt.issued = true;
      const result = await attempt.api.start({ ...attempt.key, sdp: offer.sdp, conversationSettings: input.conversationSettings });
      // The user may cancel while the IPC request is still preparing a thread.
      if (!current(attempt)) {
        const closure = closureFor(attempt);
        if (closure) await confirmClosure(closure);
        else await remoteStop(attempt).catch(() => {});
        return;
      }
      if (!result.success) throw new Error(result.error);
    } catch (error) { fail(attempt, error); }
  }

  async function stop() {
    const attempt = active;
    if (attempt) { await endAttempt(attempt); return; }
    if (closing) {
      const closure = closing;
      closure.error = undefined;
      update({ phase: "ending", error: null });
      await confirmClosure(closure);
    } else {
      update({ ...initialState });
    }
  }

  return {
    start, stop,
    getSnapshot: () => state,
    getAudioLevels: (timeMs: number) => state.phase === "connected"
      ? active?.audioMeter?.read(timeMs) ?? SILENT_VOICE_LEVELS : SILENT_VOICE_LEVELS,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    toggleMute() {
      if (!active?.stream || state.phase !== "connected") return;
      const muted = !state.muted;
      for (const track of active.stream.getAudioTracks()) track.enabled = !muted;
      active.audioMeter?.setMuted(muted);
      update({ muted });
    },
  };
}
