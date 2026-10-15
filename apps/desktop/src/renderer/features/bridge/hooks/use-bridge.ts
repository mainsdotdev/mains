import { useEffect, useState } from "react";
import { CHANNELS } from "@mains/contracts/channels";
import { useGetBridgeStatusQuery } from "@/lib/redux/api/bridgeApi";
import { useAppSelector } from "@/lib/redux/hooks";
import { getTransport } from "@/lib/transport";

export function useBridgeStatus() {
  return useGetBridgeStatusQuery(undefined, { pollingInterval: 10_000, skipPollingIfUnfocused: true });
}
export function useBridgeRun(runId: string | undefined, isReplica: boolean) {
  const { data: status } = useBridgeStatus();
  // React useId can repeat in separate browsers/windows attached to one backend.
  // getRandomValues also works on the LAN HTTP development surface.
  const [watcherId] = useState(() => Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join(""));
  const selectedBackend = useAppSelector((state) => state.backends.activeBackendId);
  const enabled = status?.enabled === true;
  useEffect(() => {
    if (!runId || !isReplica || !enabled) return;
    const transport = getTransport();
    const watch = () => { void transport.invoke(CHANNELS.bridge.watchRun, [runId, watcherId]).catch(() => {}); };
    watch(); const lease = setInterval(watch, 30_000);
    return () => { clearInterval(lease); void transport.invoke(CHANNELS.bridge.unwatchRun, [watcherId]).catch(() => {}); };
  }, [runId, isReplica, watcherId, selectedBackend, enabled]);
  return { status, run: status?.runs.find((entry) => entry.runId === runId) };
}
