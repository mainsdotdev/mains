import { SILENT_VOICE_LEVELS, type VoiceAudioLevels } from "../../workspace/lib/realtime-voice-audio";
import { followVoiceLevel, speechLevel } from "../../workspace/lib/voice-audio-levels";

export interface VoicePreviewAudioMeter {
  read(timeMs: number): VoiceAudioLevels;
  dispose(): void;
}

/** Analyze the same preview element that plays the sample, with one speaker path. */
export function createVoicePreviewAudioMeter(
  audio: HTMLAudioElement,
  createContext: () => AudioContext = () => new AudioContext({ latencyHint: "interactive" }),
): VoicePreviewAudioMeter {
  let context: AudioContext;
  try {
    context = createContext();
  } catch {
    return { read: () => SILENT_VOICE_LEVELS, dispose() {} };
  }
  let source: MediaElementAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let samples: Float32Array<ArrayBuffer> | undefined;
  let previousTime: number | undefined;
  let disposed = false;
  const levels = { input: 0, output: 0 };

  function dispose() {
    if (disposed) return;
    disposed = true;
    source?.disconnect();
    analyser?.disconnect();
    analyser = samples = undefined;
    levels.output = 0;
    void context.close().catch(() => {});
  }

  function attach() {
    if (disposed || context.state !== "running") return;
    try {
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize);
      source = context.createMediaElementSource(audio);
      // MediaElementSource replaces the element's native speaker route. Its
      // sole audible connection goes directly to destination; analysis is a branch.
      source.connect(context.destination);
      source.connect(analyser);
    } catch {
      analyser?.disconnect();
      analyser = samples = undefined;
      // If a source is already routed, keep its speaker path alive until stop.
      if (!source) dispose();
    }
  }

  if (context.state === "suspended") {
    // Start resume in the user gesture, and only reroute sound once it succeeds.
    void context.resume().then(attach).catch(dispose);
  } else {
    attach();
  }

  return {
    read(timeMs) {
      if (disposed || !analyser || !samples || context.state !== "running" || audio.paused || audio.ended) {
        previousTime = undefined;
        levels.output = 0;
        return SILENT_VOICE_LEVELS;
      }
      const elapsed = previousTime === undefined ? 1 / 60 : Math.min(0.1, Math.max(0, (timeMs - previousTime) / 1000));
      previousTime = timeMs;
      analyser.getFloatTimeDomainData(samples);
      levels.output = followVoiceLevel(levels.output, speechLevel(samples), elapsed);
      return levels;
    },
    dispose,
  };
}
