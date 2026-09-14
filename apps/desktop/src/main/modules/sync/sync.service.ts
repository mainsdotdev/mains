import { fetchEntitiesByProvider } from "./sync.fetchers";
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
      if (batch.entities.length === 0) continue;
      const stats = syncRepo.upsertEntities(batch.entities);
      totalStats.inserted += stats.inserted;
      totalStats.updated += stats.updated;
      totalStats.skipped += stats.skipped;
      totalStats.errors += stats.errors;
      totalEntities += batch.entities.length;
    }

      if (totalEntities === 0) {
        console.warn("⚠️  No entities fetched from sources");
      return createEmptyResult(Date.now() - startTime);
    }

    const duration = Date.now() - startTime;
    return createSuccessResult(totalStats, totalEntities, duration);
  },
};
