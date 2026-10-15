import { eq, and, desc, ne } from "drizzle-orm";
import { getDb } from "../../db/client";
import { spaces } from "../../db/schema";
import { ACCOUNT_ID } from "./space.constants";
import type { SpaceRecord, SpacePayload } from "./space.dto";
import type { ProviderId } from "@mains/contracts/provider-ids";
import type { ModeId } from "@mains/contracts/modes";

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
    db.transaction(() => {
      assertAvailable(data.name, data.slug);
      db.insert(spaces).values(data).run();
    });
  },

  async update(
    spaceId: string,
    data: Partial<SpacePayload> & { slug?: string }
  ): Promise<void> {
    const db = getDb();
    db.transaction(() => {
      const current = db.select().from(spaces).where(and(eq(spaces.id, spaceId), eq(spaces.accountId, ACCOUNT_ID))).get();
      if (!current) throw new Error("Space not found");
      assertAvailable(data.name !== undefined && data.name !== current.name ? data.name : undefined,
        data.slug !== undefined && data.slug !== current.slug ? data.slug : undefined, spaceId);
      db.update(spaces).set(data).where(eq(spaces.id, spaceId)).run();
    });
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

/** Validation and mutation share a transaction now that replicas may duplicate names. */
function assertAvailable(name?: string, slug?: string, exceptId?: string): void {
  const db = getDb();
  const scope = and(eq(spaces.accountId, ACCOUNT_ID), exceptId ? ne(spaces.id, exceptId) : undefined);
  if (slug !== undefined && db.select({ id: spaces.id }).from(spaces).where(and(scope, eq(spaces.slug, slug))).get())
    throw new Error("slug: A space with this slug already exists");
  if (name !== undefined && db.select({ id: spaces.id }).from(spaces).where(and(scope, eq(spaces.name, name))).get())
    throw new Error("name: A space with this name already exists");
}
