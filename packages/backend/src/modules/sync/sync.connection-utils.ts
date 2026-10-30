import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client";
import { connectionResources } from "../../db/schema";
import type { SelectedResource } from "./sync.dto";

// ─────────────────────────────────────────────────────────────
// Selected Resource Reads
// ─────────────────────────────────────────────────────────────
// The connection_resources table is deliberately not part of the
// connections aggregate (see ADR-0002) — it is read directly by
// sync, projects, and guards. Connection identity and secrets live
// behind the connections module: callers needing those should import
// `getConnectionWithSecrets` from "../connections".

export async function getSelectedResources(
  connectionId: string,
  kind?: string
): Promise<
  Array<{
    id: string;
    connectionId: string;
    externalId: string;
    name: string;
    kind: string;
    metadata: Record<string, unknown>;
  }>
> {
  try {
    const db = getDb();
    const whereConditions = [
      eq(connectionResources.connectionId, connectionId),
      eq(connectionResources.selected, true),
    ];

    if (kind) {
      whereConditions.push(eq(connectionResources.kind, kind));
    }

    const resources = db
      .select()
      .from(connectionResources)
      .where(and(...whereConditions))
      .all();

    return resources.map((r) => ({
      id: r.id,
      connectionId: r.connectionId,
      externalId: r.externalId,
      name: r.name || "Untitled",
      kind: r.kind,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    }));
  } catch (error) {
    console.error("Error getting selected resources:", error);
    return [];
  }
}

export function getResourceById(resourceId: string): SelectedResource | null {
  const row = getDb()
    .select()
    .from(connectionResources)
    .where(eq(connectionResources.id, resourceId))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    connectionId: row.connectionId,
    externalId: row.externalId,
    name: row.name || "Untitled",
    kind: row.kind,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
  };
}

// ─────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────
export function normalizeLimit(
  limit: number,
  min: number = 1,
  max: number = 100
): number {
  return Math.max(min, Math.min(max, limit));
}

/**
 * Page through a provider list until it runs dry or `limit` items are in hand.
 * `fetchPage` gets the page cursor (a page number, an offset token, …) and the
 * size to ask for, and returns that page plus the next cursor — null when done.
 * Page-number APIs must ignore the size and keep one fixed page size: page N
 * of a smaller size would overlap the pages before it.
 */
export async function collectPages<T, C>(
  limit: number,
  first: C,
  fetchPage: (cursor: C, pageSize: number) => Promise<{ items: T[]; next: C | null }>,
  maxPageSize = 100,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: C | null = first;
  while (cursor !== null && out.length < limit) {
    const page: { items: T[]; next: C | null } = await fetchPage(
      cursor,
      Math.min(maxPageSize, limit - out.length),
    );
    out.push(...page.items);
    cursor = page.next;
  }
  return out.slice(0, limit);
}

export function normalizeDateToIso(date?: string | number | Date): string {
  if (!date) return new Date().toISOString();

  if (typeof date === "number") {
    return new Date(date * 1000).toISOString();
  }

  return new Date(date).toISOString();
}

export function safeJsonParse<T = unknown>(json: string | null, fallback: T = {} as T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}
