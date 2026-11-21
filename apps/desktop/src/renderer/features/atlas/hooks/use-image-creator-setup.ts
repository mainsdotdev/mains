import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useCreateSpaceMutation, useGetRunByIdQuery, useGetSpacesQuery } from "@/lib/redux/api";
import { getTransport, onTransportChange } from "@/lib/transport";
import { createImageSetupLifecycle, findImageCreatorSpace, imageCreatorRunError } from "../lib/image-creator-lifecycle";
import { IMAGE_PROVIDERS, type ImageProvider } from "../lib/image-creation";
import { atlasError } from "./use-save-to-atlas";

export function useImageCreatorSetup(accountId: string, runId?: string, providerId: ImageProvider = "codex") {
  const { activeSpaceId, spaces, allSpaces, isLoaded } = useActiveSpace();
  const discovery = useGetSpacesQuery();
  const run = useGetRunByIdQuery(runId ?? "", { skip: !runId });
  const [createSpace] = useCreateSpaceMutation();
  const [transport] = useState(getTransport);
  const [lifecycles] = useState(() => ({
    codex: createImageSetupLifecycle(accountId, "codex", () => getTransport() === transport),
    cursor: createImageSetupLifecycle(accountId, "cursor", () => getTransport() === transport),
  }));
  const lifecycle = lifecycles[providerId];
  const state = useSyncExternalStore(lifecycle.subscribe, lifecycle.snapshot);
  const savedSpace = runId
    ? allSpaces.find((space) => space.id === run.data?.spaceId)
    : findImageCreatorSpace(accountId, providerId, spaces, activeSpaceId);
  const space = savedSpace ?? state.space;
  const workSpace = useMemo(() => space ? { ...space, mode: "work" as const } : null, [space]);
  const create = useCallback(() => createSpace({
    name: IMAGE_PROVIDERS.find((option) => option.value === providerId)!.label,
    slug: `${providerId}-images-${crypto.randomUUID()}`,
    providerId,
    mode: providerId === "cursor" ? "developer" : "work",
  }).unwrap(), [createSpace, providerId]);
  useLayoutEffect(() => {
    return onTransportChange(() => {
      lifecycles.codex.retire();
      lifecycles.cursor.retire();
    });
  }, [lifecycles]);
  useLayoutEffect(() => lifecycle.attach(), [lifecycle]);
  useEffect(() => {
    if (!isLoaded || discovery.error || discovery.isFetching || savedSpace || runId) return;
    lifecycle.ensure(create);
  }, [isLoaded, discovery.error, discovery.isFetching, savedSpace, runId, lifecycle, create]);

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
