import { followVoiceLevel, speechLevel } from "./voice-audio-levels";

export interface VoiceAudioLevels {
  readonly input: number;
  readonly output: number;
}

export const SILENT_VOICE_LEVELS: VoiceAudioLevels = Object.freeze({ input: 0, output: 0 });

export interface RealtimeVoiceAudioMeter {
  setInput(stream: MediaStream): void;
  setOutput(stream: MediaStream): void;
  setMuted(muted: boolean): void;
  read(timeMs: number): VoiceAudioLevels;
  dispose(): void;
}

interface AudioChannel {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
}

function disconnect(channel: AudioChannel | undefined) {
  channel?.source.disconnect();
  channel?.analyser.disconnect();
}

function readSpeechLevel(channel: AudioChannel | undefined): number {
  if (!channel) return 0;
  channel.analyser.getFloatTimeDomainData(channel.samples);
  return speechLevel(channel.samples);
}

/** Analysis-only branches of the existing streams; never connected to speakers. */
export function createRealtimeVoiceAudioMeter(
  createContext: () => AudioContext = () => new AudioContext({ latencyHint: "interactive" }),
): RealtimeVoiceAudioMeter {
  let context: AudioContext;
  try {
    context = createContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    // A decorative effect must not prevent a voice call on unsupported devices.
    return { setInput() {}, setOutput() {}, setMuted() {}, read: () => SILENT_VOICE_LEVELS, dispose() {} };
  }
  let input: AudioChannel | undefined;
  let output: AudioChannel | undefined;
  let muted = false;
  let disposed = false;
  let previousTime: number | undefined;
  const levels = { input: 0, output: 0 };

  function attach(stream: MediaStream): AudioChannel | undefined {
    if (disposed || stream.getAudioTracks().length === 0) return;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    try {
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      // Mic permission can arrive after the initial user activation has ended.
      if (context.state === "suspended") void context.resume().catch(() => {});
      return { source, analyser, samples: new Float32Array(analyser.fftSize) };
    } catch {
      source?.disconnect();
      analyser?.disconnect();
      return undefined;
    }
  }

  return {
    setInput(stream) { disconnect(input); input = attach(stream); levels.input = 0; },
    setOutput(stream) { disconnect(output); output = attach(stream); levels.output = 0; },
    setMuted(value) { muted = value; if (muted) levels.input = 0; },
    read(timeMs) {
      if (disposed) return SILENT_VOICE_LEVELS;
      const elapsed = previousTime === undefined ? 1 / 60 : Math.min(0.1, Math.max(0, (timeMs - previousTime) / 1000));
      previousTime = timeMs;
      levels.input = muted ? 0 : followVoiceLevel(levels.input, readSpeechLevel(input), elapsed);
      levels.output = followVoiceLevel(levels.output, readSpeechLevel(output), elapsed);
      return levels;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disconnect(input);
      disconnect(output);
      input = output = undefined;
      levels.input = levels.output = 0;
      void context.close().catch(() => {});
    },
  };
}
