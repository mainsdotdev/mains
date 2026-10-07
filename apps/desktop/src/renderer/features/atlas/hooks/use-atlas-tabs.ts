import { useLayoutEffect, useMemo } from "react";
import type { AtlasItem } from "@mains/contracts/atlas";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useListAtlasQuery } from "@/lib/redux/api/atlasApi";
import { closeAtlasPageTab, openAtlasPageTab, type AtlasPageTab } from "@/lib/redux/slices/atlasSlice";

const EMPTY_TABS: AtlasPageTab[] = [];
const EMPTY_ITEMS: AtlasItem[] = [];

export function useAtlasOwnerKey(accountId: string) {
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  return JSON.stringify([backendId ?? "local", accountId]);
}

export function useAtlasTabs(accountId: string, activeId?: string) {
  const ownerKey = useAtlasOwnerKey(accountId);
  const dispatch = useAppDispatch();
  const stored = useAppSelector((state) => state.atlas.byOwner[ownerKey]?.tabs ?? EMPTY_TABS);
  const { currentData, isFetching, isError } = useListAtlasQuery({ accountId });
  const items = currentData ?? EMPTY_ITEMS;
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const complete = currentData !== undefined && !isFetching && !isError;
  const unavailable = useMemo(() => new Set([...stored.map((tab) => tab.id), ...(activeId ? [activeId] : [])].filter((id) => {
    const item = itemsById.get(id);
    return item ? item.kind !== "page" || !!item.trashedAt : complete;
  })), [stored, activeId, itemsById, complete]);
  const activeUnavailable = !!activeId && unavailable.has(activeId);
  useLayoutEffect(() => {
    if (activeId && !activeUnavailable) dispatch(openAtlasPageTab({ ownerKey, id: activeId }));
  }, [activeId, activeUnavailable, ownerKey, dispatch]);
  useLayoutEffect(() => {
    for (const tab of stored) {
      if (unavailable.has(tab.id)) dispatch(closeAtlasPageTab({ ownerKey, id: tab.id }));
    }
  }, [stored, unavailable, ownerKey, dispatch]);

  const tabs = useMemo(() => {
    return stored.filter((tab) => !unavailable.has(tab.id)).map((tab) => ({
      id: tab.id,
      title: (tab.id === activeId ? tab.title : undefined) ?? itemsById.get(tab.id)?.title ?? tab.title ?? "Untitled page",
      icon: itemsById.get(tab.id)?.metadata?.icon,
    }));
  }, [activeId, stored, unavailable, itemsById]);
  return { ownerKey, tabs };
}
