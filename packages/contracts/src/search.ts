import type { ModeId } from "./modes";
import type { ProviderId } from "./provider-ids";

/** The durable Mains records exposed by the global command menu. */
export type GlobalSearchResultKind = "workspace" | "run" | "document";

export interface GlobalSearchQuery {
  query: string;
  accountId?: string;
  /** Maximum rows returned for each result kind. Clamped by the backend. */
  limitPerKind?: number;
}

/**
 * A deliberately small navigation read model. Search results carry enough
 * context to restore the run's provider/mode before opening it, without
 * leaking whole database rows across the transport.
 */
export interface GlobalSearchResult {
  id: string;
  kind: GlobalSearchResultKind;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  updatedAt: number;
  workspaceId: string | null;
  runId: string | null;
  collectionId: string | null;
  spaceId: string | null;
  providerId: ProviderId | null;
  mode: ModeId | null;
  path: string | null;
}
