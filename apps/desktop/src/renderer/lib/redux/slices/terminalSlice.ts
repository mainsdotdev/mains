import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export function terminalWorkspaceKey(backendId: string, workspaceId: string): string {
  return JSON.stringify([backendId, workspaceId]);
}

/** Selection only; the backend owns sessions and output, never persisted here. */
const terminalSlice = createSlice({
  name: "terminal",
  initialState: { selectedByWorkspace: {} as Record<string, string> },
  reducers: {
    selectTerminal(state, { payload }: PayloadAction<{ key: string; id: string }>) {
      state.selectedByWorkspace[payload.key] = payload.id;
    },
    forgetTerminal(state, { payload }: PayloadAction<{ key: string; id: string }>) {
      if (state.selectedByWorkspace[payload.key] === payload.id) delete state.selectedByWorkspace[payload.key];
    },
  },
});

export const { selectTerminal, forgetTerminal } = terminalSlice.actions;
export default terminalSlice.reducer;
