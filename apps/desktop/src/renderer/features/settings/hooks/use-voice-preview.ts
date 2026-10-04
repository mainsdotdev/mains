import { useCallback, useEffect, useRef, useState } from "react";
import { voicePreviewUrl } from "../lib/codex-voice-previews";
import { createVoicePreviewAudioMeter, type VoicePreviewAudioMeter } from "../lib/voice-preview-audio";
import { SILENT_VOICE_LEVELS } from "../../workspace/lib/realtime-voice-audio";

type Playback = { read: VoicePreviewAudioMeter["read"]; release(): void };
type PreviewState = { playingVoice: string | null; error: string | null };
const idle: PreviewState = { playingVoice: null, error: null };

export function useVoicePreview() {
  const current = useRef<Playback | null>(null);
  const [state, setState] = useState<PreviewState>(idle);
  const getAudioLevels = useCallback((timeMs: number) => current.current?.read(timeMs) ?? SILENT_VOICE_LEVELS, []);

  const release = useCallback(() => {
    const previous = current.current;
    current.current = null;
    previous?.release();
  }, []);

  const stop = useCallback(() => {
    release();
    setState(idle);
  }, [release]);

  const play = useCallback((voice: string) => {
    release();
    const url = voicePreviewUrl(voice);
    if (!url) {
      setState({ playingVoice: null, error: "No preview is available for this voice." });
      return;
    }

    const audio = new Audio(url);
    const meter = createVoicePreviewAudioMeter(audio);
    const onEnded = () => finish(null);
    const onError = () => finish("Unable to play this voice preview. Try again.");
    const playback: Playback = {
      read: meter.read,
      release() {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        audio.pause();
        meter.dispose();
        audio.removeAttribute("src");
        audio.load();
      },
    };
    function finish(error: string | null) {
      // A superseded play() rejection must not stop the next sample.
      if (current.current !== playback) return;
      release();
      setState({ playingVoice: null, error });
    }

    current.current = playback;
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    setState({ playingVoice: voice, error: null });
    // Keep play() inside the click/change gesture, before saving settings.
    void audio.play().catch(onError);
  }, [release]);

  useEffect(() => release, [release]);

  return { ...state, play, stop, getAudioLevels };
}
