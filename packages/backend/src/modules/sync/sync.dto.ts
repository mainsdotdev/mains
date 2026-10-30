import type { ProviderIssueState } from "@mains/contracts/issue-status";

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

/** A resource an incremental fetcher finished, and when that fetch started. */
export interface SyncCursor {
  resourceId: string;
  syncedAt: Date;
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
  /**
   * Only passed to `incremental` fetchers. Set: return every item updated since
   * this time, whatever its state, so closures arrive. Null: return the
   * resource's open items.
   */
  since?: Date | null;
}

export interface ListStatesArgs {
  resource: SelectedResource;
  secrets: Record<string, string>;
  metadata: Record<string, unknown>;
}

/** A provider workflow state as a fetcher lists it, before any user mapping. */
export type ProviderStateInput = Pick<
  ProviderIssueState,
  "id" | "name" | "color" | "defaultStatusId"
>;

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
  /**
   * Most items one fetch returns per resource. Incremental fetchers page up to
   * it; the others take it as their page size.
   */
  defaultLimit: number;
  /**
   * Honors `since`: the runner keeps a per-resource cursor (`sync_cursors`) and
   * asks only for changes. Such a fetcher must throw on any failure rather than
   * return [] — an empty result advances the cursor past the changes it missed.
   */
  incremental?: boolean;
  /** Called once per selected resource. The hot path for nearly every provider. */
  fetchForResource(args: ResourceFetcherArgs): Promise<EntityInput[]>;
  /** Optional: called when no resources are selected. Linear uses this to fetch from all teams. */
  fetchAll?(args: FetchAllArgs): Promise<EntityInput[]>;
  /**
   * Optional: every workflow state of a resource, for the user to map onto
   * Mains statuses — all of them, not just those issues sit in, since sync only
   * ever sees open issues and recent changes. Ids match the `stateId` the
   * fetcher writes. Providers with only open/closed (GitHub, GitLab) omit it.
   */
  listStates?(args: ListStatesArgs): Promise<ProviderStateInput[]>;
}

