import type {
  ResourceIssueStates,
  SetIssueStatusMappingInput,
} from "@mains/contracts/issue-status";
import { fetchEntitiesByProvider, listResourceStates } from "./sync.fetchers";
import { getResourceById } from "./sync.connection-utils";
import { syncRepo } from "./sync.repo";
import type { SyncJobResult, SyncJobStats } from "./sync.dto";

// ─────────────────────────────────────────────────────────────
// Result Builders
// ─────────────────────────────────────────────────────────────
function calculateStats(
  totalEntities: number,
  duration: number
): SyncJobResult["stats"] {
  return {
    itemsPerSecond: duration > 0 ? Math.round((totalEntities / duration) * 1000) : 0,
  };
}

function createSuccessResult(
  stats: SyncJobStats,
  totalEntities: number,
  duration: number
): SyncJobResult {
  return {
    success: true,
    inserted: stats.inserted,
    updated: stats.updated,
    skipped: stats.skipped,
    errors: stats.errors,
    total: totalEntities,
    duration,
    stats: calculateStats(totalEntities, duration),
  };
}

function createEmptyResult(duration: number): SyncJobResult {
  return {
    success: true,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    total: 0,
    duration,
    stats: { itemsPerSecond: 0 },
  };
}

// ─────────────────────────────────────────────────────────────
// Service - Business Logic
//
// `SyncJobResult.success` = the orchestration completed. Per-item failures
// live in `SyncJobResult.errors` (count); an orchestration-level failure
// throws (envelope applied by handle() at the IPC seam).
// ─────────────────────────────────────────────────────────────
export const syncService = {
  async runEntitySync(provider?: string): Promise<SyncJobResult> {
    const startTime = Date.now();

    const totalStats: SyncJobStats = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };
    let totalEntities = 0;

    // Fetch + upsert provider-by-provider so we never hold every provider's
    // payload in memory simultaneously. Each batch is released as soon as
    // the transaction finishes.
    for await (const batch of fetchEntitiesByProvider(provider)) {
      if (batch.entities.length > 0) {
        const stats = syncRepo.upsertEntities(batch.entities);
        totalStats.inserted += stats.inserted;
        totalStats.updated += stats.updated;
        totalStats.skipped += stats.skipped;
        totalStats.errors += stats.errors;
        totalEntities += batch.entities.length;
      }
      // After the upsert, never before: a cursor promises these changes are
      // stored. "Nothing changed" still advances it.
      if (batch.cursors?.length) syncRepo.saveCursors(batch.provider, batch.cursors);
    }

      if (totalEntities === 0) {
        console.warn("⚠️  No entities fetched from sources");
      return createEmptyResult(Date.now() - startTime);
    }

    const duration = Date.now() - startTime;
    return createSuccessResult(totalStats, totalEntities, duration);
  },

  /** A resource's provider workflow states, each with the status it maps to. */
  async listIssueStates(resourceId: string): Promise<ResourceIssueStates> {
    const resource = getResourceById(resourceId);
    if (!resource) throw new Error("Resource not found");

    const states = await listResourceStates(resource);
    if (!states) return { resourceId, supported: false, states: [] };

    const mappings = syncRepo.listStatusMappings(resourceId);
    return {
      resourceId,
      supported: true,
      states: states.map((state) => ({
        ...state,
        statusId: mappings.get(state.id) ?? state.defaultStatusId,
        mapped: mappings.has(state.id),
      })),
    };
  },

  async setIssueStatusMapping(input: SetIssueStatusMappingInput): Promise<{ updated: number }> {
    const { resourceId, stateId, statusId } = input ?? ({} as SetIssueStatusMappingInput);
    if (typeof resourceId !== "string" || !resourceId) throw new Error("resourceId is required");
    if (typeof stateId !== "string" || !stateId) throw new Error("stateId is required");
    if (statusId !== null && typeof statusId !== "string") {
      throw new Error("statusId must be a status id or null");
    }
    if (!getResourceById(resourceId)) throw new Error("Resource not found");
    if (statusId !== null && !syncRepo.statusExists(statusId)) {
      throw new Error(`Unknown issue status: ${statusId}`);
    }
    return { updated: syncRepo.setStatusMapping(resourceId, stateId, statusId) };
  },
};
