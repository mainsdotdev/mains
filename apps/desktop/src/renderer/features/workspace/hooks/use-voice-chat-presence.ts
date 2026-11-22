import { useLayoutEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { isAssistantsRoute } from "@/lib/layout";
import { getRouteRunId, getRouteType } from "@/lib/route-utils";
import { voiceChatPresence } from "../lib/voice-chat-presence";

export function useVoiceChatPresence(runId: string | null) {
  useLayoutEffect(() => runId ? voiceChatPresence.show(runId) : undefined, [runId]);
}

export function useIsVoiceChatVisible(runId: string | null): boolean {
  const { pathname, search } = useLocation();
  const visible = useSyncExternalStore(voiceChatPresence.subscribe, voiceChatPresence.getSnapshot, voiceChatPresence.getSnapshot);
  if (!runId || !visible.has(runId)) return false;
  if (isAssistantsRoute(pathname)) return new URLSearchParams(search).get("run") === runId;
  const routeRunId = getRouteRunId(pathname);
  return getRouteType(pathname) === "code" && (!routeRunId || routeRunId === runId);
}
