import { useLayoutEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { getRouteRunId, getRouteType } from "@/lib/route-utils";
import { voiceChatPresence } from "../lib/voice-chat-presence";

export function useVoiceChatPresence(runId: string | null) {
  useLayoutEffect(() => runId ? voiceChatPresence.show(runId) : undefined, [runId]);
}

export function useIsVoiceChatVisible(runId: string | null): boolean {
  const { pathname } = useLocation();
  const visible = useSyncExternalStore(voiceChatPresence.subscribe, voiceChatPresence.getSnapshot, voiceChatPresence.getSnapshot);
  const routeRunId = getRouteRunId(pathname);
  return !!runId && getRouteType(pathname) === "code"
    && (!routeRunId || routeRunId === runId) && visible.has(runId);
}
