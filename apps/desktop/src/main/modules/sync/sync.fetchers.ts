import { getConnectionWithSecrets } from "../connections";
import { getSelectedResources } from "./sync.connection-utils";
import { RESOURCE_FETCHERS } from "./connections";
import type { EntityInput, ResourceFetcher } from "./sync.dto";

// ─────────────────────────────────────────────────────────────
// Runner — owns connection lookup, resource iteration, and error
// logging. Each adapter implements only fetchForResource (+ optional
// fetchAll for providers like Linear that fall back to a global fetch).
// ─────────────────────────────────────────────────────────────
async function runFetcher(
  fetcher: ResourceFetcher,
  limit: number,
): Promise<EntityInput[]> {
  const connection = await getConnectionWithSecrets(fetcher.provider);
  if (!connection) {
    return [];
  }

  const resources = await getSelectedResources(
    connection.id,
    fetcher.resourceKind,
  );

  if (resources.length === 0) {
    if (!fetcher.fetchAll) {
      return [];
    }
    try {
      return await fetcher.fetchAll({
        secrets: connection.secrets,
        metadata: connection.metadata ?? {},
        limit,
        connectionId: connection.id,
      });
    } catch (err) {
      console.error(`[Sync] ${fetcher.id} fetchAll failed:`, err);
      return [];
    }
  }

  const out: EntityInput[] = [];
  for (const resource of resources) {
    try {
      const items = await fetcher.fetchForResource({
        resource,
        secrets: connection.secrets,
        metadata: connection.metadata ?? {},
        limit,
        connectionId: connection.id,
      });
      out.push(...items);
    } catch (err) {
      console.error(
        `[Sync] ${fetcher.id} failed for resource ${resource.externalId}:`,
        err,
      );
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────
function fetchersForProvider(provider?: string): ResourceFetcher[] {
  if (!provider) return RESOURCE_FETCHERS;
  const matching = RESOURCE_FETCHERS.filter((f) => f.provider === provider);
  return matching.length > 0 ? matching : RESOURCE_FETCHERS;
}

export async function fetchAllEntities(
  provider?: string,
): Promise<EntityInput[]> {
  const fetchers = fetchersForProvider(provider);
  const results = await Promise.allSettled(
    fetchers.map((f) => runFetcher(f, f.defaultLimit)),
  );

  const entities: EntityInput[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      entities.push(...result.value);
    } else {
      console.error(`[Sync] ${fetchers[i].id} failed:`, result.reason);
    }
  }

  console.log(
    `[Sync] Fetched ${entities.length} entities from ${fetchers.length} fetchers${provider ? ` (provider: ${provider})` : ""}`,
  );
  return entities;
}

/**
 * Yield each fetcher's batch as it completes. The service consumes this
 * generator and persists each batch immediately, so we never hold every
 * provider's payload in memory simultaneously.
 */
export async function* fetchEntitiesByProvider(
  provider?: string,
): AsyncGenerator<{ provider: string; entities: EntityInput[] }> {
  const fetchers = fetchersForProvider(provider);

  for (const fetcher of fetchers) {
    try {
      const entities = await runFetcher(fetcher, fetcher.defaultLimit);
      yield { provider: fetcher.id, entities };
    } catch (err) {
      console.error(`[Sync] ${fetcher.id} failed:`, err);
    }
  }
}

// Re-export the registry for tests / introspection.
export { RESOURCE_FETCHERS };
