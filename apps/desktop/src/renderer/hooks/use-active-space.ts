import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { useGetAppSettingsQuery, useGetSpacesQuery } from "@/lib/redux/api";
import type { Space } from "@/lib/redux/api/spaceApi";

const ActiveSpaceOverrideContext = createContext<Space | null>(null);

/** The floating chat reads the main window's current Space, not its own stale query cache. */
export function ActiveSpaceOverrideProvider({
  space,
  children,
}: {
  space: Space;
  children?: ReactNode;
}) {
  return createElement(ActiveSpaceOverrideContext.Provider, { value: space }, children);
}

export function useActiveSpace() {
  const override = useContext(ActiveSpaceOverrideContext);
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

  const activeSpaceId = override?.id ?? appSettings?.activeSpaceId ?? "";

  /** False until both queries have data — gate provider-keyed mounts on this. */
  const isLoaded = !!override || (!isLoadingSettings && !isLoadingSpaces);

  const spaces = useMemo(() => {
    return allSpaces.filter((s) => !s.isArchived);
  }, [allSpaces]);

  const activeSpace = useMemo(() => {
    return override ?? allSpaces.find((m) => m.id === activeSpaceId);
  }, [override, allSpaces, activeSpaceId]);

  return {
    activeSpaceId,
    activeSpace,
    isLoaded,
    spaces,
    allSpaces,
  };
}
