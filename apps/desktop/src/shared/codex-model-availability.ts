import type { RateLimitInfo, RateLimitSnapshotInfo } from "./adapter.types";

function reserveModelSlug(
  limitId: string,
  snapshot: RateLimitSnapshotInfo,
): string | undefined {
  const isReserve =
    limitId === "base_model_inference" || snapshot.limitName === "gpt-reserve";
  return isReserve ? snapshot.normalModelSlug : undefined;
}

/**
 * Models backed by a separate reserve allowance in the current Codex usage
 * snapshot. The backend owns these ids; keeping them dynamic avoids baking a
 * particular generation's fallback model into Mains.
 */
export function getCodexReserveModelSlugs(
  rateLimits: RateLimitInfo | null | undefined,
): string[] {
  const slugs = Object.entries(rateLimits?.rateLimitsByLimitId ?? {})
    .map(([limitId, snapshot]) => reserveModelSlug(limitId, snapshot))
    .filter((slug): slug is string => Boolean(slug));
  return [...new Set(slugs)];
}

/**
 * `model/list` is a catalog, not a statement that every model can currently
 * run. Once the account explicitly disallows ordinary usage, expose only the
 * backend-advertised reserve models. A missing permission/reserve signal stays
 * fail-open for older compatible app-server responses.
 */
export function filterCodexModelsForUsage<T extends { id: string }>(
  models: T[],
  rateLimits: RateLimitInfo | null | undefined,
): T[] {
  if (rateLimits?.ordinaryUsageAllowed !== false) return models;
  const reserveModels = new Set(getCodexReserveModelSlugs(rateLimits));
  if (reserveModels.size === 0) return models;
  return models.filter((model) => reserveModels.has(model.id));
}
