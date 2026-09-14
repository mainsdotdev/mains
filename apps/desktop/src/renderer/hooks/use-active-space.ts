import { useMemo } from "react";
import { useGetAppSettingsQuery, useGetSpacesQuery } from "@/lib/redux/api";

export function useActiveSpace() {
  // selectFromResult keeps subscribers from re-rendering on isFetching flips —
  // this hook feeds provider resolution app-wide (AppContent included), so a
  // default subscription would fan every spaces refetch out to the whole tree.
  const { data: appSettings, isLoading: isLoadingSettings } =
    useGetAppSettingsQuery(undefined, {
      selectFromResult: ({ data, isLoading }) => ({ data, isLoading }),
    });
  const { data: allSpaces = [], isLoading: isLoadingSpaces } =
    useGetSpacesQuery(undefined, {
      selectFromResult: ({ data, isLoading }) => ({ data, isLoading }),
    });

  const activeSpaceId = appSettings?.activeSpaceId || "";

  /** False until both queries have data — gate provider-keyed mounts on this. */
  const isLoaded = !isLoadingSettings && !isLoadingSpaces;

  const spaces = useMemo(() => {
    return allSpaces.filter((s) => !s.isArchived);
  }, [allSpaces]);

  const activeSpace = useMemo(() => {
    return allSpaces.find((m) => m.id === activeSpaceId);
  }, [allSpaces, activeSpaceId]);

  return {
    activeSpaceId,
    activeSpace,
    isLoaded,
    spaces,
    allSpaces,
  };
}
