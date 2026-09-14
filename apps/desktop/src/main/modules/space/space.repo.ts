import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../../db/client";
import { spaces } from "../../db/schema";
import { ACCOUNT_ID } from "./space.constants";
import type { SpaceRecord, SpacePayload } from "./space.dto";
import type { ProviderId } from "../../../shared/provider-ids";
import type { ModeId } from "../../../shared/modes";

// ─────────────────────────────────────────────────────────────
// Space Repository
// ─────────────────────────────────────────────────────────────
export const spaceRepo = {
  async findAll(): Promise<SpaceRecord[]> {
    const db = getDb();
    return db.query.spaces.findMany({
      where: eq(spaces.accountId, ACCOUNT_ID),
      orderBy: [spaces.sortOrder, desc(spaces.createdAt)],
    }) as Promise<SpaceRecord[]>;
  },

  async findById(spaceId: string): Promise<SpaceRecord | undefined> {
    const db = getDb();
    return db.query.spaces.findFirst({
      where: and(eq(spaces.id, spaceId), eq(spaces.accountId, ACCOUNT_ID)),
    }) as Promise<SpaceRecord | undefined>;
  },

  async findBySlug(slug: string): Promise<SpaceRecord | undefined> {
    const db = getDb();
    return db.query.spaces.findFirst({
      where: and(eq(spaces.accountId, ACCOUNT_ID), eq(spaces.slug, slug)),
    }) as Promise<SpaceRecord | undefined>;
  },

  async getMaxSortOrder(): Promise<number> {
    const db = getDb();
    const result = await db
      .select({ maxOrder: spaces.sortOrder })
      .from(spaces)
      .where(eq(spaces.accountId, ACCOUNT_ID))
      .orderBy(desc(spaces.sortOrder))
      .limit(1);

    return result.length > 0 && result[0].maxOrder !== null
      ? result[0].maxOrder + 1
      : 0;
  },

  async create(data: {
    id: string;
    accountId: string;
    name: string;
    slug: string;
    description: string | null;
    systemPrompt: string | null;
    model: string | null;
    icon: string | null;
    themeConfig: string | null;
    providerId: ProviderId;
    mode: ModeId;
    sortOrder: number;
  }): Promise<void> {
    const db = getDb();
    await db.insert(spaces).values(data);
  },

  async update(
    spaceId: string,
    data: Partial<SpacePayload> & { slug?: string }
  ): Promise<void> {
    const db = getDb();
    await db.update(spaces).set(data).where(eq(spaces.id, spaceId));
  },

  async delete(spaceId: string): Promise<void> {
    const db = getDb();
    await db.delete(spaces).where(eq(spaces.id, spaceId));
  },

  async archive(spaceId: string): Promise<void> {
    const db = getDb();
    await db
      .update(spaces)
      .set({ isArchived: true })
      .where(eq(spaces.id, spaceId));
  },

  async unarchive(spaceId: string): Promise<void> {
    const db = getDb();
    await db
      .update(spaces)
      .set({ isArchived: false })
      .where(eq(spaces.id, spaceId));
  },
};
