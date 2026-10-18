import { useEffect, useState, useSyncExternalStore } from "react";
import type { AtlasGeneratedFile } from "@mains/contracts/atlas";
import { appApi } from "@/lib/transport";
import { getTransport, onTransportChange } from "@/lib/transport/registry";

type ReplicaFile = Pick<NonNullable<AtlasGeneratedFile["replica"]>, "attachmentId" | "artifactId">;

/** Downloads a file of another device's conversation through its synced attachment or output. */
export async function resolveReplicaFile(runId: string, { attachmentId, artifactId }: ReplicaFile): Promise<string> {
  const response = attachmentId !== undefined
    ? await appApi.runArtifacts.resolveAttachmentPath({ runId, attachmentId })
    : await appApi.runArtifacts.resolveFilePath({ runId, artifactId });
  if (!response.success || !response.data) throw new Error(response.error ?? "File unavailable");
  return response.data as string;
}

/** Resolve only mounted files; library listings never download the account. */
export function useAtlasFilePath(accountId?: string, id?: string, fallback?: string | null, generated?: AtlasGeneratedFile) {
  const replicaRunId = generated?.replica ? generated.runId : undefined;
  const attachmentId = generated?.replica?.attachmentId, artifactId = generated?.replica?.artifactId;
  const key = JSON.stringify([accountId, id, fallback, replicaRunId, attachmentId, artifactId]);
  const transport = useSyncExternalStore(onTransportChange, getTransport);
  const [resolved, setResolved] = useState<{ key: string; path: string; transport: typeof transport }>();
  useEffect(() => {
    if (!(id && accountId) && !replicaRunId) return;
    let canceled = false;
    void (async () => {
      try {
        let path: string | undefined;
        if (id && accountId) {
          const response = await appApi.atlas.resolveFile({ accountId, id });
          if (response.success && response.data) path = response.data as string;
        } else path = await resolveReplicaFile(replicaRunId!, { attachmentId, artifactId });
        if (!canceled && getTransport() === transport && path) setResolved({ key, path, transport });
      } catch { /* Leave the existing placeholder available on failed downloads. */ }
    })();
    return () => { canceled = true; };
  }, [accountId, id, key, transport, replicaRunId, attachmentId, artifactId]);
  return resolved?.key === key && resolved.transport === transport ? resolved.path : fallback;
}
