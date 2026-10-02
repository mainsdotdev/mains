import type { PersistedState } from "redux-persist";

/** Keep legacy entry ids until live app metadata can resolve their plugin owner. */
export function migrateMcpAppPinSettings(state: PersistedState): PersistedState {
  if (!state) return state;
  const saved = state as typeof state & {
    pinnedMcpAppIdsByProvider?: Record<string, string[]>;
    pinnedMcpAppKeysByProvider?: Record<string, string[]>;
  };
  const { pinnedMcpAppIdsByProvider, ...rest } = saved;
  const migrated = { ...rest, pinnedMcpAppKeysByProvider: {
    ...pinnedMcpAppIdsByProvider, ...saved.pinnedMcpAppKeysByProvider,
  } };
  return migrated;
}
