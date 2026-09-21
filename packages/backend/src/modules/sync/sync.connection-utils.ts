import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client";
import { connectionResources } from "../../db/schema";

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
