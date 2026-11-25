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
export interface BridgeBlockedRecord {
  table: string; pk: string; register: string; stream: string;
  label: string; error: string; attempts: number; retryAt: string;
}
export interface BridgeStatus {
  enabled: boolean;
  state: "disabled" | "connecting" | "syncing" | "connected" | "read-only" | "offline" | "error";
  backendId: string;
  label: string;
  lastSyncedAt: string | null;
  error: string | null;
  pendingRecords: number;
  /** Synced changes this backend could not verify or apply; set aside instead of stopping sync. Absent on older backends. */
  rejectedRecords?: number;
  /** Local changes retained for retry after a preparation failure; details are bounded to 20. */
  blockedRecordCount?: number;
  blockedRecords?: BridgeBlockedRecord[];
  /** Upload pacing after the hub's write rate limit; reads remain live. */
  writeRetryAt?: string | null;
  backends: BridgeBackendInfo[];
  runs: BridgeRunState[];
  quota?: BridgeQuota | null;
}
export interface BridgeQuota {
  plan: string; limitBytes: number; usedBytes: number; recordBytes: number; blobBytes: number; reservedBytes: number;
  /** Stored ciphertext already released from the user's quota, awaiting physical collection. */
  retainedBlobBytes?: number;
  storageManagement?: boolean;
  fileLimitBytes: number; writesPerMinute: number;
  subscription?: import("./bridge-subscription").BridgeSubscription;
  plans?: import("./bridge-subscription").BridgePlan[];
}
export interface BridgeStorageItem {
  id: string;
  kind: "run" | "account";
  recordBytes: number;
  blobBytes: number;
  reclaimableBlobBytes: number;
  ownerBackendId?: string;
  ownerRetired?: boolean;
}
/** A hub returns opaque identifiers. The approved backend adds local display metadata. */
export interface BridgeStorageInventory {
  items: BridgeStorageItem[];
  hasMore: boolean;
}
export interface BridgeStorageOverview {
  items: (BridgeStorageItem & { title: string; canDelete: boolean; ownerLabel?: string })[];
  hasMore: boolean;
}
export interface BridgeProjectScope {
  id: string; name: string; localOnly: boolean; workspaces: number; runs: number;
}
