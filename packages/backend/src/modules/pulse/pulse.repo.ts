import { eq, sql, and, lte, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/client";
import { pulses } from "../../db/schema";
import type { CreatePulseInput, Pulse, UpdatePulseInput } from "./pulse.dto";

export const pulseRepo = {
  findAll(): Pulse[] {
    const db = getDb();
    return db.select().from(pulses).orderBy(asc(pulses.createdAt)).all();
  },

  findActive(): Pulse[] {
    const db = getDb();
    return db.select().from(pulses).where(eq(pulses.isActive, true)).all();
  },

  findById(id: string): Pulse | undefined {
    const db = getDb();
    return db.select().from(pulses).where(eq(pulses.id, id)).get();
  },

  findDueActive(now: Date): Pulse[] {
    const db = getDb();
    return db
      .select()
      .from(pulses)
      .where(and(eq(pulses.isActive, true), lte(pulses.nextRunAt, now)))
      .all();
  },

  findNextScheduled(): Pulse | undefined {
    const db = getDb();
    return db
      .select()
      .from(pulses)
      .where(eq(pulses.isActive, true))
      .orderBy(asc(pulses.nextRunAt))
      .limit(1)
      .get();
  },

  create(accountId: string, input: CreatePulseInput, nextRunAt: Date): Pulse {
    const db = getDb();
    const id = nanoid();
    db.insert(pulses)
      .values({
        id,
        accountId,
        workspaceId: input.workspaceId ?? null,
        collectionId: input.collectionId ?? null,
        // Fixed at creation, like runs snapshot theirs — a pulse's mode is
        // its execution shape, not a setting to flip later.
        mode: input.mode ?? "developer",
        providerId: input.providerId,
        model: input.model,
        title: input.title,
        prompt: input.prompt,
        frequency: input.frequency,
        dayOfWeek: input.frequency === "weekly" ? input.dayOfWeek ?? null : null,
        hour: input.hour,
        minute: input.minute,
        timezone: input.timezone,
        thinkingMode: input.thinkingMode ?? false,
        effortLevel: input.effortLevel ?? null,
        isActive: input.isActive ?? true,
        nextRunAt,
      })
      .run();
    return this.findById(id)!;
  },

  update(id: string, input: UpdatePulseInput, nextRunAt?: Date): Pulse | undefined {
    const db = getDb();
    const updates: Record<string, any> = { ...input, updatedAt: sql`(unixepoch())` };
    if (nextRunAt !== undefined) updates.nextRunAt = nextRunAt;
    db.update(pulses).set(updates).where(eq(pulses.id, id)).run();
    return this.findById(id);
  },

  delete(id: string): void {
    const db = getDb();
    db.delete(pulses).where(eq(pulses.id, id)).run();
  },

  /**
   * Atomically bump nextRunAt without touching anything else.
   * Used to "claim" a pulse before kicking off its run so concurrent scheduling
   * passes (catch-up + scheduleNext race) don't pick the same pulse twice.
   */
  claimNextRun(id: string, nextRunAt: Date): void {
    const db = getDb();
    db.update(pulses)
      .set({ nextRunAt, updatedAt: sql`(unixepoch())` })
      .where(eq(pulses.id, id))
      .run();
  },

  markRun(
    id: string,
    fields: { lastRunAt: Date; nextRunAt: Date; lastRunId?: string | null; lastError?: string | null },
  ): void {
    const db = getDb();
    db.update(pulses)
      .set({
        lastRunAt: fields.lastRunAt,
        nextRunAt: fields.nextRunAt,
        lastRunId: fields.lastRunId ?? null,
        lastError: fields.lastError ?? null,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(pulses.id, id))
      .run();
  },
};
