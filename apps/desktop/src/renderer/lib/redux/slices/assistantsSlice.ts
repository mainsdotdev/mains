import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface AssistantConversationView {
  runIds: string[];
  activeRunId: string;
  draftOpen: boolean;
}

export interface AssistantsState {
  views: Record<string, AssistantConversationView>;
}

export function assistantConversationOwner(backendId: string, accountId: string, assistantId: string): string {
  return JSON.stringify([backendId, accountId, assistantId]);
}

export function closeAssistantTab(view: AssistantConversationView, id: string): AssistantConversationView {
  const index = id === "new" ? view.runIds.length : view.runIds.indexOf(id);
  const runIds = view.runIds.filter(runId => runId !== id);
  let draftOpen = id === "new" ? false : view.draftOpen;
  let activeRunId = view.activeRunId;
  if (activeRunId === id) {
    activeRunId = runIds[Math.max(0, Math.min(index, runIds.length - 1))] ?? "new";
    if (activeRunId === "new") draftOpen = true;
  }
  return { runIds, draftOpen, activeRunId };
}

const assistantsSlice = createSlice({
  name: "assistants",
  initialState: { views: {} } as AssistantsState,
  reducers: {
    visitAssistantConversation(state, { payload }: PayloadAction<{ ownerKey: string; runId: string; initialIds: string[] }>) {
      const current = state.views[payload.ownerKey] ??= { runIds: [...payload.initialIds], activeRunId: payload.runId, draftOpen: false };
      if (payload.runId === "new") current.draftOpen = true;
      else if (!current.runIds.includes(payload.runId)) current.runIds.push(payload.runId);
      current.activeRunId = payload.runId;
      // Keep lightweight conversation identities, bounded independently of history.
      while (Object.keys(state.views).length > 128) delete state.views[Object.keys(state.views)[0]];
    },
    closeAssistantConversation(state, { payload }: PayloadAction<{ ownerKey: string; runId: string }>) {
      const current = state.views[payload.ownerKey];
      if (current) state.views[payload.ownerKey] = closeAssistantTab(current, payload.runId);
    },
    replaceAssistantConversationDraft(state, { payload }: PayloadAction<{ ownerKey: string; runId: string }>) {
      const current = state.views[payload.ownerKey] ??= { runIds: [], activeRunId: payload.runId, draftOpen: false };
      if (!current.runIds.includes(payload.runId)) current.runIds.push(payload.runId);
      current.draftOpen = false;
      current.activeRunId = payload.runId;
    },
  },
});

export const { visitAssistantConversation, closeAssistantConversation, replaceAssistantConversationDraft } = assistantsSlice.actions;
export default assistantsSlice.reducer;
