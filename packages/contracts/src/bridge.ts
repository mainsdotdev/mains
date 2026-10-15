/** UI-facing Bridge state. Secrets and transport credentials never cross this seam. */
export interface BackendOwnership { ownerBackendId: string; isReplica: boolean }
export interface BridgeBackendInfo {
  backendId: string;
  label: string;
  platform: string | null;
  /** null means this backend cannot currently observe the hub's presence. */
  online: boolean | null;
  lastSeen: string | null;
}
export interface BridgeRunState {
  runId: string;
  ready: boolean;
  error: string | null;
}
export interface BridgeStatus {
  enabled: boolean;
  state: "disabled" | "connecting" | "syncing" | "connected" | "offline" | "error";
  backendId: string;
  label: string;
  lastSyncedAt: string | null;
  error: string | null;
  pendingRecords: number;
  backends: BridgeBackendInfo[];
  runs: BridgeRunState[];
}
