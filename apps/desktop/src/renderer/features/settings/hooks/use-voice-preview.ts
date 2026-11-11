import { useCallback, useEffect, useRef, useState } from "react";
import { voicePreviewUrl } from "../lib/codex-voice-previews";
import { createVoicePreviewAudioMeter, type VoicePreviewAudioMeter } from "../lib/voice-preview-audio";
import { SILENT_VOICE_LEVELS } from "../../workspace/lib/realtime-voice-audio";
import { createVoicePreviewLifecycle, idleVoicePreview, releaseSpeechResources } from "@/lib/speech-lifecycle";

type Playback = { read: VoicePreviewAudioMeter["read"]; play(): Promise<void>; release(): void };

export function useVoicePreview() {
  const owner = useRef<ReturnType<typeof createVoicePreviewLifecycle<Playback>> | null>(null);
  const [state, setState] = useState(idleVoicePreview);
  const getAudioLevels = useCallback((timeMs: number) => owner.current?.resource()?.read(timeMs) ?? SILENT_VOICE_LEVELS, []);
  useEffect(() => {
    const lifecycle = createVoicePreviewLifecycle<Playback>({
      change: setState,
      acquire(voice, finish) {
        const url = voicePreviewUrl(voice);
        if (!url) return null;
        const audio = new Audio(url);
        const meter = createVoicePreviewAudioMeter(audio);
        const onEnded = () => finish(null);
        const onError = () => finish("Unable to play this voice preview. Try again.");
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);
        return {
          read: meter.read, play: () => audio.play(),
          release() {
            releaseSpeechResources(
              () => audio.removeEventListener("ended", onEnded),
              () => audio.removeEventListener("error", onError),
              () => audio.pause(), () => meter.dispose(),
              () => audio.removeAttribute("src"), () => audio.load(),
            );
          },
        };
      },
    });
    owner.current = lifecycle;
    return () => { lifecycle.close(); if (owner.current === lifecycle) owner.current = null; };
  }, []);
  const play = useCallback((voice: string) => owner.current?.play(voice) ?? (() => {}), []);
  const stop = useCallback(() => owner.current?.stop(), []);
  return { ...state, play, stop, getAudioLevels };
}
