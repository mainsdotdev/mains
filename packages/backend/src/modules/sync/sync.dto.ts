// ─────────────────────────────────────────────────────────────
// Sync Job Types
// ─────────────────────────────────────────────────────────────
export interface SyncJobResult {
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  total: number;
  duration: number;
  stats: {
    itemsPerSecond: number;
  };
}

export interface SyncJobStats {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

// ─────────────────────────────────────────────────────────────
// Entity Types
// ─────────────────────────────────────────────────────────────
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JSONValue }
  | JSONValue[];

export interface EntityInput {
  kind: string;
  title: string;
  url: string;
  body: string | null;
  summary: string | null;
  occurredAt: string;
  connectionId?: string | null;
  resourceId?: string | null;
  externalId?: string | null;
  metadata?: JSONValue | null;
}

export interface EntityQueryParams {
  kinds: string[];
  connectionIds: string[];
  limit: number;
}

// ─────────────────────────────────────────────────────────────
// Resource Fetcher — the seam between sync core and per-provider
// adapters. The core owns connection lookup, resource selection,
// iteration, and error handling. Each adapter owns only the
// SDK/HTTP call + entity normalization.
// ─────────────────────────────────────────────────────────────

export interface SelectedResource {
  id: string;
  connectionId: string;
  externalId: string;
  name: string;
  kind: string;
  metadata: Record<string, unknown>;
}

export interface ResourceFetcherArgs {
  resource: SelectedResource;
  secrets: Record<string, string>;
  metadata: Record<string, unknown>;
  limit: number;
  connectionId: string;
}

export interface FetchAllArgs {
  secrets: Record<string, string>;
  metadata: Record<string, unknown>;
  limit: number;
  connectionId: string;
}

export interface ResourceFetcher {
  /** Unique identifier, e.g. "github:issues". Used for per-fetcher limit overrides + log lines. */
  id: string;
  /** Provider key matching connections.provider, e.g. "github". */
  provider: string;
  /** connectionResources.kind to iterate over, e.g. "github_repo". */
  resourceKind: string;
  /** Default page size when no override is supplied. */
  defaultLimit: number;
  /** Called once per selected resource. The hot path for nearly every provider. */
  fetchForResource(args: ResourceFetcherArgs): Promise<EntityInput[]>;
  /** Optional: called when no resources are selected. Linear uses this to fetch from all teams. */
  fetchAll?(args: FetchAllArgs): Promise<EntityInput[]>;
}

