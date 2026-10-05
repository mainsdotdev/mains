import { useEffect, useRef, useSyncExternalStore } from "react";
import { CHANNELS } from "@mains/contracts/channels";
import type { RunRealtimeEvent } from "@mains/contracts/realtime";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { getTransport, onTransportChange } from "@/lib/transport";
import { createRealtimeVoiceController } from "../lib/realtime-voice-controller";
import { createRealtimeVoiceAudioMeter } from "../lib/realtime-voice-audio";
import { toast } from "@/components/ui";

let controller: ReturnType<typeof createRealtimeVoiceController> | undefined;
function getController() {
  return controller ??= createRealtimeVoiceController({
    api: () => {
      // Keep the original backend for stop, even if the user switches hosts.
      const transport = getTransport();
      return {
        start: (payload) => transport.invoke(CHANNELS.runs.startRealtime, [payload]) as Promise<ServiceResponse<void>>,
        stop: (payload) => transport.invoke(CHANNELS.runs.stopRealtime, [payload]) as Promise<ServiceResponse<void>>,
        subscribe: (listener) => transport.subscribe(CHANNELS.runs.realtimeEvent, (event) => listener(event as RunRealtimeEvent)),
      };
    },
    getUserMedia: () => navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }),
    createPeer: () => new RTCPeerConnection(),
    createAudio: () => new Audio(),
    createAudioMeter: createRealtimeVoiceAudioMeter,
    createId: () => crypto.randomUUID(),
  });
}

export function useRealtimeVoice() {
  const voice = getController();
  const state = useSyncExternalStore(voice.subscribe, voice.getSnapshot, voice.getSnapshot);
  return { state, start: voice.start, stop: voice.stop, toggleMute: voice.toggleMute, getAudioLevels: voice.getAudioLevels };
}

/** Mounted once by the app shell, independently of composer mounts. */
export function useRealtimeVoiceLifecycle() {
  const reportedError = useRef<string | null>(null);
  useEffect(() => {
    const voice = getController();
    // Keep failures visible without adding status text around the orb.
    const reportError = () => {
      const { error } = voice.getSnapshot();
      if (error && error !== reportedError.current) toast.error(error);
      reportedError.current = error;
    };
    const offVoice = voice.subscribe(reportError);
    reportError();
    const stop = () => { void voice.stop(); };
    window.addEventListener("beforeunload", stop);
    const watchConnection = () => getTransport().onStatusChange((status) => {
      if (status !== "connected") stop();
    });
    let offStatus = watchConnection();
    const off = onTransportChange(() => { stop(); offStatus(); offStatus = watchConnection(); });
    return () => { window.removeEventListener("beforeunload", stop); offVoice(); off(); offStatus(); stop(); };
  }, []);
}
