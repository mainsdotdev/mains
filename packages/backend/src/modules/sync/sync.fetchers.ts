import { getConnectionWithSecrets } from "../connections";
import { getSelectedResources } from "./sync.connection-utils";
import { syncRepo } from "./sync.repo";
import { RESOURCE_FETCHERS } from "./connections";
import type {
  EntityInput,
  ProviderStateInput,
  ResourceFetcher,
  ResourceFetcherArgs,
  SelectedResource,
  SyncCursor,
} from "./sync.dto";

/** Clock skew between us and a provider; items in the overlap re-upsert harmlessly. */
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;

const withOverlap = (date: Date) => new Date(date.getTime() - CURSOR_OVERLAP_MS);

interface FetcherRun {
  entities: EntityInput[];
  /** Saved only after the entities are persisted. */
  cursors: SyncCursor[];
}

/** Later items win: the change feed is at least as fresh as the open set. */
function dedupeByUrl(items: EntityInput[]): EntityInput[] {
  return [...new Map(items.map((item) => [item.url, item])).values()];
}

/**
 * One resource of an incremental fetcher. With a cursor: what changed since.
 * Without one (first run): the open set — plus, when rows were synced before
 * cursors existed, every change since the stalest open row was last seen, so
 * issues closed in the meantime stop showing as open.
 */
async function fetchIncremental(
  fetcher: ResourceFetcher,
  args: ResourceFetcherArgs,
): Promise<EntityInput[]> {
  const cursor = syncRepo.getCursor(fetcher.id, args.resource.id);
  if (cursor) return fetcher.fetchForResource({ ...args, since: withOverlap(cursor) });

  const catchUpFrom = syncRepo.oldestOpenIssueSeenAt(args.resource.id);
  const open = await fetcher.fetchForResource({ ...args, since: null });
  if (!catchUpFrom) return open;
  const changed = await fetcher.fetchForResource({
    ...args,
    since: withOverlap(catchUpFrom),
  });
  return dedupeByUrl([...open, ...changed]);
}

// ─────────────────────────────────────────────────────────────
// Runner — owns connection lookup, resource iteration, cursors, and
// error logging. Each adapter implements only fetchForResource (+
// optional fetchAll for providers like Linear that fall back to a
// global fetch).
// ─────────────────────────────────────────────────────────────
async function runFetcher(
  fetcher: ResourceFetcher,
  limit: number,
): Promise<FetcherRun> {
  const connection = await getConnectionWithSecrets(fetcher.provider);
  if (!connection) {
    return { entities: [], cursors: [] };
  }

  const resources = await getSelectedResources(
    connection.id,
    fetcher.resourceKind,
  );

  if (resources.length === 0) {
    if (!fetcher.fetchAll) {
      return { entities: [], cursors: [] };
    }
    try {
      const entities = await fetcher.fetchAll({
        secrets: connection.secrets,
        metadata: connection.metadata ?? {},
        limit,
        connectionId: connection.id,
      });
      return { entities, cursors: [] };
    } catch (err) {
      console.error(`[Sync] ${fetcher.id} fetchAll failed:`, err);
      return { entities: [], cursors: [] };
    }
  }

  const entities: EntityInput[] = [];
  const cursors: SyncCursor[] = [];
  for (const resource of resources) {
    // Taken before the request, so a change made mid-fetch is asked for again.
    const startedAt = new Date();
    const args: ResourceFetcherArgs = {
      resource,
      secrets: connection.secrets,
      metadata: connection.metadata ?? {},
      limit,
      connectionId: connection.id,
    };
    try {
      if (fetcher.incremental) {
        entities.push(...(await fetchIncremental(fetcher, args)));
        cursors.push({ resourceId: resource.id, syncedAt: startedAt });
      } else {
        entities.push(...(await fetcher.fetchForResource(args)));
      }
    } catch (err) {
      // No cursor: the next run asks for this window again.
      console.error(
        `[Sync] ${fetcher.id} failed for resource ${resource.externalId}:`,
        err,
      );
    }
  }
  return { entities, cursors };
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
      entities.push(...result.value.entities);
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
): AsyncGenerator<{ provider: string; entities: EntityInput[]; cursors: SyncCursor[] }> {
  const fetchers = fetchersForProvider(provider);

  for (const fetcher of fetchers) {
    try {
      const { entities, cursors } = await runFetcher(fetcher, fetcher.defaultLimit);
      // `provider` is the fetcher id — what the cursors are keyed by.
      yield { provider: fetcher.id, entities, cursors };
    } catch (err) {
      console.error(`[Sync] ${fetcher.id} failed:`, err);
    }
  }
}

/**
 * Every workflow state a resource's provider defines, as its fetcher lists
 * them — null when the provider has none to map (GitHub, GitLab). Throws when
 * the connection is gone or the provider call fails.
 */
export async function listResourceStates(
  resource: SelectedResource,
): Promise<ProviderStateInput[] | null> {
  const fetcher = RESOURCE_FETCHERS.find(
    (f) => f.resourceKind === resource.kind && f.listStates,
  );
  if (!fetcher?.listStates) return null;

  const connection = await getConnectionWithSecrets(fetcher.provider);
  if (!connection || connection.id !== resource.connectionId) {
    throw new Error("This connection is no longer connected");
  }
  return fetcher.listStates({
    resource,
    secrets: connection.secrets,
    metadata: connection.metadata ?? {},
  });
}

// Re-export the registry for tests / introspection.
export { RESOURCE_FETCHERS };
