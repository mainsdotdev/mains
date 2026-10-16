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
  state: "disabled" | "connecting" | "syncing" | "connected" | "read-only" | "offline" | "error";
  backendId: string;
  label: string;
  lastSyncedAt: string | null;
  error: string | null;
  pendingRecords: number;
  backends: BridgeBackendInfo[];
  runs: BridgeRunState[];
  quota?: BridgeQuota | null;
}
export interface BridgeQuota {
  plan: string; limitBytes: number; usedBytes: number; recordBytes: number; blobBytes: number; reservedBytes: number;
  fileLimitBytes: number; writesPerMinute: number;
  subscription?: import("./bridge-subscription").BridgeSubscription;
  plans?: import("./bridge-subscription").BridgePlan[];
}
export interface BridgeProjectScope {
  id: string; name: string; localOnly: boolean; workspaces: number; runs: number;
}
