import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useCreateSpaceMutation, useGetRunByIdQuery, useGetSpacesQuery } from "@/lib/redux/api";
import { getTransport, onTransportChange } from "@/lib/transport";
import { createImageSetupLifecycle, findImageCreatorSpace, imageCreatorRunError } from "../lib/image-creator-lifecycle";
import { atlasError } from "./use-save-to-atlas";

export function useImageCreatorSetup(accountId: string, runId?: string) {
  const { activeSpaceId, spaces, allSpaces, isLoaded } = useActiveSpace();
  const discovery = useGetSpacesQuery();
  const run = useGetRunByIdQuery(runId ?? "", { skip: !runId });
  const [createSpace] = useCreateSpaceMutation();
  const [transport] = useState(getTransport);
  const [lifecycle] = useState(() => createImageSetupLifecycle(accountId, () => getTransport() === transport));
  const state = useSyncExternalStore(lifecycle.subscribe, lifecycle.snapshot);
  const savedSpace = runId
    ? findImageCreatorSpace(accountId, allSpaces, undefined, run.data?.spaceId ?? null)
    : findImageCreatorSpace(accountId, spaces, activeSpaceId);
  const space = savedSpace ?? state.space;
  const workSpace = useMemo(() => space ? { ...space, mode: "work" as const } : null, [space]);
  const create = () => createSpace({ name: "Codex", slug: `codex-images-${crypto.randomUUID()}`, providerId: "codex", mode: "work" }).unwrap();
  useLayoutEffect(() => {
    const detach = lifecycle.attach();
    const off = onTransportChange(() => lifecycle.retire());
    return () => { off(); detach(); };
  }, [lifecycle]);
  useEffect(() => {
    if (!isLoaded || discovery.error || discovery.isFetching || savedSpace || runId) return;
    lifecycle.ensure(() => createSpace({ name: "Codex", slug: `codex-images-${crypto.randomUUID()}`, providerId: "codex", mode: "work" }).unwrap());
  }, [isLoaded, discovery.error, discovery.isFetching, savedSpace, runId, lifecycle, createSpace]);

  let error: string | null = imageCreatorRunError(accountId, runId, run.data, run.error, isLoaded, space);
  if (discovery.error) error = "Could not load your spaces.";
  else if (!error && state.phase === "error") error = atlasError(state.error);
  else if (state.phase === "retired") error = "The image creator connection changed. Reopen it to continue.";
  return {
    space: error || !isLoaded || (runId && !run.data) ? null : workSpace,
    collectionId: run.data?.collectionId,
    error,
    canRetry: !!discovery.error || !!run.error || state.phase === "error",
    retry: () => { if (discovery.error) void discovery.refetch(); else if (run.error) void run.refetch(); else lifecycle.retry(create); },
  };
}
