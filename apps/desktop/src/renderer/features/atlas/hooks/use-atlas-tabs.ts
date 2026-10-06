import { useLayoutEffect, useMemo } from "react";
import type { AtlasItem } from "@mains/contracts/atlas";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useListAtlasQuery } from "@/lib/redux/api/atlasApi";
import { openAtlasPageTab, type AtlasPageTab } from "@/lib/redux/slices/atlasSlice";

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
  const { data: items = EMPTY_ITEMS } = useListAtlasQuery({ accountId });
  useLayoutEffect(() => {
    if (activeId) dispatch(openAtlasPageTab({ ownerKey, id: activeId }));
  }, [activeId, ownerKey, dispatch]);

  const tabs = useMemo(() => {
    const opened = activeId && !stored.some((tab) => tab.id === activeId) ? [...stored, { id: activeId }] : stored;
    return opened.map((tab) => ({
      id: tab.id,
      title: (tab.id === activeId ? tab.title : undefined) ?? items.find((item) => item.id === tab.id)?.title ?? tab.title ?? "Untitled page",
      icon: items.find((item) => item.id === tab.id)?.metadata?.icon,
    }));
  }, [activeId, stored, items]);
  return { ownerKey, tabs };
}
