/**
 * Note: Avoid scheduling at 2:00-3:00 AM due to DST changes
 * See: https://www.endpointdev.com/blog/2013/04/avoid-200-and-300-am-cron-jobs/
 */

// IPC
export { registerSyncIpc, unregisterSyncIpc } from "./sync.ipc";

// Service
export { syncService } from "./sync.service";

// Repository

// Fetchers
export { fetchAllEntities } from "./sync.fetchers";

// Helpers
export {
  pickUrl,
  isValidUrl,
  sanitizeUrl,
  formatDuration,
} from "./sync.helpers";

// Connection-resource reads + sync-side utilities.
// Connection identity / secrets live behind the connections module —
// callers import `getConnectionWithSecrets` from "../connections".
export {
  getSelectedResources,
  normalizeLimit,
  normalizeDateToIso,
  safeJsonParse,
} from "./sync.connection-utils";

// DTOs
export type {
  SyncJobResult,
  SyncJobStats,
  EntityInput,
  EntityQueryParams,
  JSONValue,
} from "./sync.dto";

// Connections
export * from "./connections";
