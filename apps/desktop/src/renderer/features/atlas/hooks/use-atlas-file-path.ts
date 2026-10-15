import { useEffect, useState, useSyncExternalStore } from "react";
import { appApi } from "@/lib/transport";
import { getTransport, onTransportChange } from "@/lib/transport/registry";

/** Resolve only mounted files; library listings never download the account. */
export function useAtlasFilePath(accountId?: string, id?: string, fallback?: string | null) {
  const key = JSON.stringify([accountId, id, fallback]);
  const transport = useSyncExternalStore(onTransportChange, getTransport);
  const [resolved, setResolved] = useState<{ key: string; path: string; transport: typeof transport }>();
  useEffect(() => {
    if (!id || !accountId) return;
    let canceled = false;
    void (async () => {
      try {
        const response = await appApi.atlas.resolveFile({ accountId, id });
        if (!canceled && getTransport() === transport && response.success && response.data)
          setResolved({ key, path: response.data as string, transport });
      } catch { /* Leave the existing placeholder available on failed downloads. */ }
    })();
    return () => { canceled = true; };
  }, [accountId, id, key, transport]);
  return resolved?.key === key && resolved.transport === transport ? resolved.path : fallback;
}
