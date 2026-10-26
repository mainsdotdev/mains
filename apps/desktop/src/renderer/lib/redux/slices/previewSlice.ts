import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DocumentViewerDoc } from "./appSettingsSlice";
import { transferRightPaneContext, forgetRunRightPane, forgetWorkspaceRightPanes } from "./appSettingsSlice";
import { runOwnerKey, workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";

export type PreviewTab =
  | { kind: "browser"; id: string; title: string; faviconUrl: string | null; isLoading: boolean; isCrashed: boolean }
  | { kind: "document"; id: string; doc: DocumentViewerDoc }
  | { kind: "app"; id: string; title: string };

export interface PreviewGroup {
  tabs: PreviewTab[];
  activeTabId: string | null;
  open: boolean;
  expanded: boolean;
}

export const EMPTY_PREVIEW_GROUP: PreviewGroup = { tabs: [], activeTabId: null, open: false, expanded: false };
export interface PreviewState { byOwner: Record<string, PreviewGroup> }
const initialState: PreviewState = { byOwner: {} };

function groupFor(state: PreviewState, ownerKey: string): PreviewGroup {
  return state.byOwner[ownerKey] ??= { ...EMPTY_PREVIEW_GROUP, tabs: [] };
}

function removeTab(group: PreviewGroup, id: string) {
  const index = group.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  group.tabs.splice(index, 1);
  if (group.activeTabId === id) group.activeTabId = group.tabs[Math.min(index, group.tabs.length - 1)]?.id ?? null;
  if (!group.tabs.length) group.open = false;
}

const previewSlice = createSlice({
  name: "preview",
  initialState,
  reducers: {
    openPreviewTab(state, { payload }: PayloadAction<{ ownerKey: string; tab: PreviewTab }>) {
      const group = groupFor(state, payload.ownerKey);
      const incoming = payload.tab;
      const index = group.tabs.findIndex((tab) => tab.id === incoming.id ||
        (tab.kind === "document" && incoming.kind === "document" && tab.doc.path === incoming.doc.path));
      const id = index < 0 ? incoming.id : group.tabs[index].id;
      if (index < 0) group.tabs.push(payload.tab);
      else group.tabs[index] = { ...payload.tab, id };
      group.activeTabId = id;
      group.open = true;
    },
    selectPreviewTab(state, { payload }: PayloadAction<{ ownerKey: string; id: string }>) {
      const group = state.byOwner[payload.ownerKey];
      if (!group?.tabs.some((tab) => tab.id === payload.id)) return;
      group.activeTabId = payload.id;
      group.open = true;
    },
    closePreviewTab(state, { payload }: PayloadAction<{ ownerKey: string; id: string }>) {
      const group = state.byOwner[payload.ownerKey];
      if (group) removeTab(group, payload.id);
    },
    setPreviewOpen(state, { payload }: PayloadAction<{ ownerKey: string; open: boolean }>) {
      const group = groupFor(state, payload.ownerKey);
      group.open = payload.open && group.tabs.length > 0;
    },
    setPreviewExpanded(state, { payload }: PayloadAction<{ ownerKey: string; expanded: boolean }>) {
      groupFor(state, payload.ownerKey).expanded = payload.expanded;
    },
    transferPreviewTab(state, { payload: { fromKey, toKey, id } }: PayloadAction<{ fromKey: string; toKey: string; id: string }>) {
      if (fromKey === toKey) return;
      const source = state.byOwner[fromKey];
      const tab = source?.tabs.find((item) => item.id === id);
      if (!tab) return;
      const target = groupFor(state, toKey);
      if (!target.tabs.some((item) => item.id === id)) target.tabs.push(tab);
      if (source.activeTabId === id) { target.activeTabId = id; target.open = source.open; }
      removeTab(source, id);
    },
    syncBrowserPreviewTabs(state, { payload }: PayloadAction<{
      ownerKey: string; tabs: Extract<PreviewTab, { kind: "browser" }>[];
      activeTabId: string; activate?: boolean;
    }>) {
      const group = groupFor(state, payload.ownerKey);
      const ids = new Set(payload.tabs.map((tab) => tab.id));
      for (const tab of [...group.tabs]) if (tab.kind === "browser" && !ids.has(tab.id)) removeTab(group, tab.id);
      for (const tab of payload.tabs) {
        const index = group.tabs.findIndex((item) => item.id === tab.id);
        if (index < 0) group.tabs.push(tab);
        else group.tabs[index] = tab;
      }
      if (payload.activate && ids.has(payload.activeTabId)) {
        group.activeTabId = payload.activeTabId;
        group.open = true;
      } else if (!group.activeTabId) {
        group.activeTabId = group.tabs[0]?.id ?? null;
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(transferRightPaneContext, (state, { payload: { fromKey, toKey } }) => {
      // Code uses a workspace owner and never needs this draft-to-chat move.
      const source = state.byOwner[fromKey];
      if (!source || fromKey === toKey) return;
      const target = state.byOwner[toKey];
      if (target) {
        const ids = new Set(target.tabs.map((tab) => tab.id));
        target.tabs.push(...source.tabs.filter((tab) => !ids.has(tab.id)));
        if (source.open) { target.open = true; target.activeTabId = source.activeTabId; }
      } else state.byOwner[toKey] = source;
      delete state.byOwner[fromKey];
    });
    builder.addCase(forgetRunRightPane, (state, { payload }) => {
      delete state.byOwner[runOwnerKey(payload.backendId, payload.runId)];
    });
    builder.addCase(forgetWorkspaceRightPanes, (state, { payload }) => {
      delete state.byOwner[workspaceBrowserExpansionKey(payload.backendId, payload.workspaceId)];
    });
  },
});

export const { openPreviewTab, selectPreviewTab, closePreviewTab, setPreviewOpen, setPreviewExpanded, transferPreviewTab, syncBrowserPreviewTabs } = previewSlice.actions;
export default previewSlice.reducer;
