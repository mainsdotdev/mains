import { useState, useEffect, useLayoutEffect, useRef } from "react";

const SPEECH_LANG = "en-US";

export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Latest-callback ref: lets the SDK callback fire the most recent
  // `onTranscript` without tearing down + rebuilding the SpeechRecognition
  // instance on every render (which would also kill any in-flight session
  // if the caller doesn't memoize the handler).
  const onTranscriptRef = useRef(onTranscript);
  useLayoutEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      !("webkitSpeechRecognition" in window) &&
      !("SpeechRecognition" in window)
    ) {
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LANG;

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      onTranscriptRef.current(transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);

    return () => {
      try {
        recognition.stop();
      } catch {
        /* noop */
      }
      recognitionRef.current = null;
    };
  }, []);

  const toggle = () => {
    if (!recognitionRef.current) return;
    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch (error) {
        console.error("Speech recognition error:", error);
      }
    }
  };

  return { isRecording, toggle };
}
