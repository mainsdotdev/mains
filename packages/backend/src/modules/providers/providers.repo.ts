import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { safeJsonParse } from "../../db/utils";
import { providers } from "../../db/schema";
import type {
  CreateProviderPayload,
  UpdateProviderPayload,
  ProviderResponse,
} from "./providers.dto";

// ─────────────────────────────────────────────────────────────
// Providers Repository
// ─────────────────────────────────────────────────────────────
export const providersRepo = {
  async findAll(): Promise<ProviderResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(providers)
      .orderBy(desc(providers.updatedAt));

    return rows.map(mapRowToResponse);
  },

  async findById(id: string): Promise<ProviderResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(providers)
      .where(eq(providers.id, id))
      .limit(1);

    return rows[0] ? mapRowToResponse(rows[0]) : null;
  },

  async findByKind(kind: "llm_runtime" | "agent_runtime"): Promise<ProviderResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(providers)
      .where(eq(providers.kind, kind))
      .orderBy(desc(providers.updatedAt));

    return rows.map(mapRowToResponse);
  },

  async findEnabled(): Promise<ProviderResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(providers)
      .where(eq(providers.isEnabled, true))
      .orderBy(desc(providers.updatedAt));

    return rows.map(mapRowToResponse);
  },

  async insert(payload: CreateProviderPayload): Promise<string> {
    const db = getDb();
    await db.insert(providers).values({
      id: payload.id,
      kind: payload.kind,
      displayName: payload.displayName,
      isEnabled: payload.isEnabled ?? true,
      config: payload.config ? JSON.stringify(payload.config) : null,
      capabilities: payload.capabilities ? JSON.stringify(payload.capabilities) : null,
      defaultModel: payload.defaultModel,
    });

    return payload.id;
  },

  async update(id: string, payload: UpdateProviderPayload): Promise<ProviderResponse | null> {
    const db = getDb();
    const updateData: Record<string, unknown> = {
      updatedAt: sql`(unixepoch())`,
    };

    if (payload.displayName !== undefined) updateData.displayName = payload.displayName;
    if (payload.isEnabled !== undefined) updateData.isEnabled = payload.isEnabled;
    if (payload.config !== undefined) updateData.config = JSON.stringify(payload.config);
    if (payload.capabilities !== undefined)
      updateData.capabilities = JSON.stringify(payload.capabilities);
    if (payload.defaultModel !== undefined) updateData.defaultModel = payload.defaultModel;

    await db.update(providers).set(updateData).where(eq(providers.id, id));

    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.delete(providers).where(eq(providers.id, id));
  },

  async setEnabled(id: string, isEnabled: boolean): Promise<void> {
    const db = getDb();
    await db
      .update(providers)
      .set({ isEnabled, updatedAt: sql`(unixepoch())` })
      .where(eq(providers.id, id));
  },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function mapRowToResponse(row: typeof providers.$inferSelect): ProviderResponse {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.displayName,
    isEnabled: row.isEnabled,
    config: safeJsonParse(row.config),
    capabilities: safeJsonParse(row.capabilities),
    defaultModel: row.defaultModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
