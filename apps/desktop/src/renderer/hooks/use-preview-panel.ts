import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useModeConfig } from "./use-mode-config";
import { isAtlasRoute, shouldHideRightPanel } from "@/lib/layout";
import { workspaceBrowserExpansionKey } from "../../shared/ui-state-keys";
import { EMPTY_PREVIEW_GROUP, selectPreviewTab, setPreviewOpen, setPreviewExpanded } from "@/lib/redux/slices/previewSlice";
import { setRightPanelOpen, setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";

export function usePreviewPanel() {
  const dispatch = useAppDispatch();
  const { pathname } = useLocation();
  const { mode } = useModeConfig();
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  const workspaceId = useAppSelector((state) => state.workspace.activeWorkspaceId);
  const composerKey = useAppSelector((state) => state.workspace.composerContextKey);
  const ready = useAppSelector((state) => state.workspace.composerContextReady);
  const atlas = isAtlasRoute(pathname);
  const ownerKey = atlas ? JSON.stringify([backendId ?? "local", "atlas-preview"])
    : mode === "developer" && workspaceId ? workspaceBrowserExpansionKey(backendId, workspaceId) : composerKey;
  const group = useAppSelector((state) => state.preview.byOwner[ownerKey] ?? EMPTY_PREVIEW_GROUP);
  const activeTab = group.tabs.find((tab) => tab.id === group.activeTabId) ?? null;
  const isOpen = group.open && !!activeTab && (atlas || ready) && !shouldHideRightPanel(pathname);
  const reveal = useCallback(() => {
    dispatch(setRightPanelOpen(false));
    dispatch(setSessionPanelOpen(false));
  }, [dispatch]);
  const select = useCallback((id: string) => {
    reveal();
    dispatch(selectPreviewTab({ ownerKey, id }));
  }, [dispatch, ownerKey, reveal]);
  const hide = useCallback(() => { dispatch(setPreviewOpen({ ownerKey, open: false })); }, [dispatch, ownerKey]);
  const toggleExpanded = useCallback(() => {
    if (!atlas) dispatch(setPreviewExpanded({ ownerKey, expanded: !group.expanded }));
  }, [dispatch, ownerKey, group.expanded, atlas]);
  return { ownerKey, group, activeTab, isOpen, isExpanded: isOpen && group.expanded && !atlas,
    workspaceScoped: !atlas && mode === "developer" && !!workspaceId,
    canExpand: !atlas, select, hide, reveal, toggleExpanded };
}
