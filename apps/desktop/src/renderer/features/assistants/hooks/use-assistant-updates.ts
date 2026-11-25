import { useEffect, useSyncExternalStore } from "react";
import { CHANNELS } from "@mains/contracts/channels";
import { useAppDispatch } from "@/lib/redux/hooks";
import { assistantsApi } from "@/lib/redux/api/assistantsApi";
import { getTransport, onTransportChange } from "@/lib/transport";

/** The assistant page and its sidebar share the same query cache. */
export function useAssistantUpdates(watchTeamWork = false) {
  const dispatch = useAppDispatch();
  const transport = useSyncExternalStore(onTransportChange, getTransport);
  useEffect(() => {
    let attached = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (attached) dispatch(assistantsApi.util.invalidateTags(["Assistants", "AssistantChats", "AssistantTeamWork", "Pulse"]));
      }, 150);
    };
    const off = [CHANNELS.assistants.changed, CHANNELS.runs.statusChanged, CHANNELS.runs.updated].map(channel => transport.subscribe(channel, refresh));
    if (watchTeamWork) {
      const refreshTeamWork = () => dispatch(assistantsApi.util.invalidateTags(["AssistantTeamWork"]));
      for (const channel of [CHANNELS.runs.toolApprovalRequest, CHANNELS.runs.toolApprovalResolved]) {
        off.push(transport.subscribe(channel, refreshTeamWork));
      }
    }
    const reconnect = transport.onStatusChange(status => { if (status === "connected") refresh(); });
    window.addEventListener("focus", refresh);
    return () => { attached = false; clearTimeout(timer); off.forEach(stop => stop()); reconnect(); window.removeEventListener("focus", refresh); };
  }, [transport, dispatch, watchTeamWork]);
}
