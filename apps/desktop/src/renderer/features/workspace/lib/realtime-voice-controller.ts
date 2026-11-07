import type { ConversationSettings } from "@mains/contracts/run-settings";
import type { RunRealtimeEvent, RunRealtimeStartPayload, RunRealtimeStopPayload, RunRealtimeUpdate } from "@mains/contracts/realtime";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { SILENT_VOICE_LEVELS, type RealtimeVoiceAudioMeter } from "./realtime-voice-audio";
import { createRealtimeVoiceLifecycle, type RealtimeVoicePhase } from "./realtime-voice-lifecycle";

export interface VoiceTranscript {
  itemId: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface RealtimeVoiceState {
  phase: RealtimeVoicePhase;
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
  label: string;
  startedAt: number;
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

function releaseResource(dispose: () => void) {
  try { dispose(); }
  catch (error) { console.warn("[Voice] Resource cleanup failed:", error); }
}

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
  const listeners = new Set<() => void>();
  function update(patch: Partial<RealtimeVoiceState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  const lifecycle = createRealtimeVoiceLifecycle<VoiceAttempt>({
    releaseMedia: release,
    unsubscribe(attempt) {
      const off = attempt.off;
      attempt.off = undefined;
      if (off) releaseResource(off);
    },
    stopNative: remoteStop,
    transition(phase, attempt, error) {
      if (phase === "idle") update({ ...initialState });
      else if (phase === "connected") update({ phase });
      else if (phase === "connecting" && attempt) {
        update({ ...initialState, phase, runId: attempt.key.runId, label: attempt.label,
          connectionId: attempt.key.connectionId, startedAt: attempt.startedAt });
      } else update({ phase, muted: false, error: error ?? null });
    },
  });
  const current = lifecycle.current;
  function mediaReady(attempt: VoiceAttempt) {
    if (!current(attempt) || !attempt.serverReady || attempt.peer?.connectionState !== "connected") return;
    clearTimeout(attempt.timer);
    lifecycle.connected(attempt);
  }
  function release(attempt: VoiceAttempt) {
    clearTimeout(attempt.timer);
    // One failed media cleanup must not keep another resource (especially the
    // microphone) alive or prevent the id-scoped native stop from being sent.
    releaseResource(() => attempt.audioMeter?.dispose());
    attempt.audioMeter = undefined;
    if (attempt.channel) {
      attempt.channel.onopen = null;
      attempt.channel.onclose = null;
      attempt.channel.onerror = null;
      releaseResource(() => attempt.channel!.close());
    }
    attempt.contextQueue.length = 0;
    attempt.contextIds.clear();
    if (attempt.peer) {
      attempt.peer.onconnectionstatechange = null;
      attempt.peer.ontrack = null;
      releaseResource(() => attempt.peer!.close());
    }
    for (const track of attempt.stream?.getTracks() ?? []) {
      track.onended = null;
      releaseResource(() => { track.enabled = false; track.stop(); });
    }
    if (attempt.audio) {
      attempt.audio.srcObject = null;
      releaseResource(() => attempt.audio!.pause());
    }
  }
  async function remoteStop(attempt: VoiceAttempt) {
    if (!attempt.issued) return;
    const result = await attempt.api.stop(attempt.key);
    if (!result.success) throw new Error(result.error);
  }
  function fail(attempt: VoiceAttempt, error: unknown) {
    if (!current(attempt)) return;
    const name = error instanceof Error ? error.name : "";
    const message = name === "NotAllowedError"
      ? "Allow microphone access in macOS settings to start voice chat."
      : name === "NotFoundError" ? "No microphone was found."
      : error instanceof Error ? error.message : String(error);
    void lifecycle.end(attempt, message);
  }
  function handleEvent(attempt: VoiceAttempt, event: RunRealtimeEvent) {
    if (event.runId !== attempt.key.runId || event.connectionId !== attempt.key.connectionId) return;
    if (event.type === "closed") {
      lifecycle.closed(attempt);
      return;
    }
    if (!current(attempt)) return;
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
      case "ending": void lifecycle.end(attempt); break;
      case "error": fail(attempt, new Error(event.message)); break;
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
    if (lifecycle.owned) return;
    const attempt: VoiceAttempt = {
      key: { runId: input.runId, accountId: input.accountId, connectionId: options.createId() },
      api: options.api(), label: input.label, startedAt: Date.now(),
      issued: false, serverReady: false, signalQueue: Promise.resolve(),
      contextQueue: [], contextIds: new Set(),
    };
    if (!lifecycle.start(attempt)) return;
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
        await lifecycle.settleStart(attempt);
        return;
      }
      if (!result.success) throw new Error(result.error);
    } catch (error) { fail(attempt, error); }
  }

  return {
    start, stop: lifecycle.stop,
    getSnapshot: () => state,
    getAudioLevels: (timeMs: number) => state.phase === "connected"
      ? lifecycle.active?.audioMeter?.read(timeMs) ?? SILENT_VOICE_LEVELS : SILENT_VOICE_LEVELS,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    toggleMute() {
      const active = lifecycle.active;
      if (!active?.stream || state.phase !== "connected") return;
      const muted = !state.muted;
      for (const track of active.stream.getAudioTracks()) track.enabled = !muted;
      active.audioMeter?.setMuted(muted);
      update({ muted });
    },
  };
}
