import { useEffect, useState } from "react";
import { appApi } from "@/lib/transport";
import { getTransport, onTransportChange } from "@/lib/transport/registry";

/** Only registered, selected files in this replica conversation can resolve. */
export function useReplicaFilePath(runId?: string, sourcePath?: string) {
  const [value, setValue] = useState<{ runId: string; sourcePath: string; path?: string; error?: string }>();
  useEffect(() => onTransportChange(() => setValue(undefined)), []);
  useEffect(() => {
    if (!runId || !sourcePath) return;
    let canceled = false; const transport = getTransport();
    void appApi.runArtifacts.resolveFilePath({ runId, sourcePath }).then((result) => {
      if (!canceled && getTransport() === transport) setValue({ runId, sourcePath, ...(result.success ? { path: result.data } : { error: result.error }) });
    }, (error: unknown) => { if (!canceled) setValue({ runId, sourcePath, error: error instanceof Error ? error.message : "File unavailable" }); });
    return () => { canceled = true; };
  }, [runId, sourcePath]);
  return value?.runId === runId && value?.sourcePath === sourcePath ? value : undefined;
}
