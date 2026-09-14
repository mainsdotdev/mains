import { createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit";

/**
 * A saved remote backend the UI can connect to (a `mains serve` instance reached
 * over WebSocket). Mirrors t3code's KnownEnvironment. See docs/design/remote-backend.md.
 */
/** SSH tunnel config for a backend reached via `ssh -L` (see ssh.service). */
export interface BackendSshConfig {
  host: string;
  remotePort: number;
  remoteCommand?: string;
}

export interface KnownBackend {
  id: string;
  label: string;
  /** Direct WebSocket URL (e.g. `ws://127.0.0.1:8787`). Set for direct backends. */
  wsUrl?: string;
  /** SSH config. Set for tunneled backends; the ws URL is derived per connect. */
  ssh?: BackendSshConfig;
  /** Whether a pairing token is stored (encrypted) in main for this backend. */
  hasToken?: boolean;
  /** Last successful connect time (epoch ms), or null if never connected. */
  lastConnectedAt: number | null;
}

export interface BackendsState {
  saved: KnownBackend[];
  /**
   * The active remote backend id, or null when running on the local in-process
   * backend. Not persisted — the app always starts local and the user reconnects.
   */
  activeBackendId: string | null;
}

const initialState: BackendsState = {
  saved: [],
  activeBackendId: null,
};

const backendsSlice = createSlice({
  name: "backends",
  initialState,
  reducers: {
    addBackend: {
      reducer: (state, action: PayloadAction<KnownBackend>) => {
        state.saved.push(action.payload);
      },
      prepare: (input: {
        id?: string;
        label: string;
        wsUrl?: string;
        ssh?: BackendSshConfig;
        hasToken?: boolean;
      }) => ({
        payload: {
          id: input.id ?? nanoid(),
          label: input.label.trim(),
          wsUrl: input.wsUrl?.trim(),
          ssh: input.ssh,
          hasToken: input.hasToken ?? false,
          lastConnectedAt: null,
        } satisfies KnownBackend,
      }),
    },
    removeBackend: (state, action: PayloadAction<string>) => {
      state.saved = state.saved.filter((b) => b.id !== action.payload);
      if (state.activeBackendId === action.payload) {
        state.activeBackendId = null;
      }
    },
    renameBackend: (
      state,
      action: PayloadAction<{ id: string; label: string }>,
    ) => {
      const backend = state.saved.find((b) => b.id === action.payload.id);
      if (backend) backend.label = action.payload.label.trim();
    },
    setActiveBackend: (state, action: PayloadAction<string | null>) => {
      state.activeBackendId = action.payload;
    },
    markConnected: (
      state,
      action: PayloadAction<{ id: string; at: number }>,
    ) => {
      const backend = state.saved.find((b) => b.id === action.payload.id);
      if (backend) backend.lastConnectedAt = action.payload.at;
    },
  },
});

export const {
  addBackend,
  removeBackend,
  renameBackend,
  setActiveBackend,
  markConnected,
} = backendsSlice.actions;

export default backendsSlice.reducer;
