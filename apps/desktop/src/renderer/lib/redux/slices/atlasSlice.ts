import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FloatingChatMode } from "../../../../shared/floating-chat";

export interface AtlasPageTab { id: string; title?: string }
export interface AtlasPageChatState {
  runId: string | null;
  spaceId: string | null;
  draft: string;
  mode: FloatingChatMode;
}
export interface AtlasViewState {
  tabs: AtlasPageTab[];
  chats: Record<string, AtlasPageChatState>;
}
export interface AtlasCoverPosition { coverFileId: string; coverPositionY: number }
export interface AtlasState {
  byOwner: Record<string, AtlasViewState>;
  coverPositions: Record<string, Record<string, AtlasCoverPosition>>;
}
const initialState: AtlasState = { byOwner: {}, coverPositions: {} };

function view(state: AtlasState, ownerKey: string) {
  return state.byOwner[ownerKey] ??= { tabs: [], chats: {} };
}

const atlasSlice = createSlice({
  name: "atlas",
  initialState,
  reducers: {
    setAtlasCoverPosition(state, { payload }: PayloadAction<{ ownerKey: string; id: string; coverFileId: string; coverPositionY: number }>) {
      if (!Number.isFinite(payload.coverPositionY)) return;
      const positions = state.coverPositions[payload.ownerKey] ??= {};
      positions[payload.id] = { coverFileId: payload.coverFileId, coverPositionY: Math.max(0, Math.min(100, payload.coverPositionY)) };
    },
    openAtlasPageTab(state, { payload }: PayloadAction<{ ownerKey: string; id: string }>) {
      const tabs = view(state, payload.ownerKey).tabs;
      if (!tabs.some((tab) => tab.id === payload.id)) tabs.push({ id: payload.id });
    },
    renameAtlasPageTab(state, { payload }: PayloadAction<{ ownerKey: string; id: string; title: string }>) {
      const tab = view(state, payload.ownerKey).tabs.find((item) => item.id === payload.id);
      if (tab) tab.title = payload.title;
    },
    closeAtlasPageTab(state, { payload }: PayloadAction<{ ownerKey: string; id: string }>) {
      const current = view(state, payload.ownerKey);
      current.tabs = current.tabs.filter((tab) => tab.id !== payload.id);
    },
    updateAtlasPageChat(state, { payload }: PayloadAction<{ ownerKey: string; id: string; patch: Partial<AtlasPageChatState> }>) {
      const chats = view(state, payload.ownerKey).chats;
      const current = chats[payload.id] ?? { runId: null, spaceId: null, draft: "", mode: "input" };
      chats[payload.id] = { ...current, ...payload.patch };
    },
  },
});

export const { openAtlasPageTab, renameAtlasPageTab, closeAtlasPageTab, updateAtlasPageChat, setAtlasCoverPosition } = atlasSlice.actions;
export default atlasSlice.reducer;
