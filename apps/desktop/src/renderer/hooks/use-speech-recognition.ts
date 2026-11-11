import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createDictationLifecycle } from "@/lib/speech-lifecycle";

export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const owner = useRef<ReturnType<typeof createDictationLifecycle> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  useLayoutEffect(() => { onTranscriptRef.current = onTranscript; });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) return;
    const lifecycle = createDictationLifecycle(() => new Recognition(), {
      transcript: (text) => onTranscriptRef.current(text), recording: setIsRecording,
      error: (error) => console.error("Speech recognition error:", error),
    });
    owner.current = lifecycle;
    return () => { lifecycle.close(); if (owner.current === lifecycle) owner.current = null; };
  }, []);
  const toggle = useCallback(() => owner.current?.toggle(), []);
  return { isRecording, toggle };
}
