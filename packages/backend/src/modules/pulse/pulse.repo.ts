import { getLocalBackendId } from "../../db/backend-identity";
import { ownedHere } from "../bridge";
import { eq, sql, and, lte, asc, getTableColumns } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/client";
import { pulses, assistantAssignments, runs, workspaces } from "../../db/schema";
import type { CreatePulseInput, Pulse, UpdatePulseInput } from "./pulse.dto";

const pulseColumns = {
  ...getTableColumns(pulses),
  // Assignment workers reserve their identity before the run row exists.
  lastRunId: sql<string | null>`coalesce(${runs.id}, ${pulses.lastRunId})`,
  lastAssignmentStatus: assistantAssignments.status,
};

export const pulseRepo = {
  routineWorkspace(id: string) {
    return getDb().select({ accountId: workspaces.accountId, isArchived: workspaces.isArchived })
      .from(workspaces).where(eq(workspaces.id, id)).get();
  },
  findAll(): Pulse[] {
    const db = getDb();
    return db.select(pulseColumns).from(pulses)
      .leftJoin(assistantAssignments, eq(assistantAssignments.id, pulses.lastAssignmentId))
      .leftJoin(runs, eq(runs.id, assistantAssignments.workerRunId))
      .orderBy(asc(pulses.createdAt)).all();
  },

  findActive(): Pulse[] {
    const db = getDb();
    return db.select().from(pulses).where(and(ownedHere(pulses.ownerBackendId), eq(pulses.isActive, true))).all();
  },

  findById(id: string): Pulse | undefined {
    const db = getDb();
    return db.select(pulseColumns).from(pulses)
      .leftJoin(assistantAssignments, eq(assistantAssignments.id, pulses.lastAssignmentId))
      .leftJoin(runs, eq(runs.id, assistantAssignments.workerRunId))
      .where(eq(pulses.id, id)).get();
  },

  findForAssistant(accountId: string, assistantId: string, offset = 0): Pulse[] {
    return getDb().select(pulseColumns).from(pulses)
      .leftJoin(assistantAssignments, eq(assistantAssignments.id, pulses.lastAssignmentId))
      .leftJoin(runs, eq(runs.id, assistantAssignments.workerRunId))
      .where(and(eq(pulses.accountId, accountId), eq(pulses.assistantId, assistantId), ownedHere(pulses.ownerBackendId)))
      .orderBy(asc(pulses.createdAt), asc(pulses.id)).limit(101).offset(offset).all();
  },

  findDueActive(now: Date): Pulse[] {
    const db = getDb();
    return db
      .select()
      .from(pulses)
      .where(and(ownedHere(pulses.ownerBackendId), eq(pulses.isActive, true), lte(pulses.nextRunAt, now)))
      .all();
  },

  findNextScheduled(): Pulse | undefined {
    const db = getDb();
    return db
      .select()
      .from(pulses)
      .where(and(ownedHere(pulses.ownerBackendId), eq(pulses.isActive, true)))
      .orderBy(asc(pulses.nextRunAt))
      .limit(1)
      .get();
  },

  create(accountId: string, input: CreatePulseInput, nextRunAt: Date, id = nanoid()): Pulse {
    const db = getDb();
    db.insert(pulses)
      .values({
      ownerBackendId: getLocalBackendId(db),
        id,
        accountId,
        assistantId: input.assistantId ?? null,
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

  pauseAssistantRoutines(assistantId: string): string[] {
    return getDb().update(pulses).set({ isActive: false, updatedAt: sql`(unixepoch())` })
      .where(and(eq(pulses.assistantId, assistantId), ownedHere(pulses.ownerBackendId)))
      .returning({ id: pulses.id }).all().map(row => row.id);
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

  /** Restore a retired preparation's slot without overwriting a newer schedule. */
  releaseClaim(id: string, claimed: Date, previous: Date | null): void {
    getDb().update(pulses).set({ nextRunAt: previous })
      .where(and(eq(pulses.id, id), eq(pulses.nextRunAt, claimed))).run();
  },

  markRun(
    id: string,
    fields: { lastRunAt: Date; nextRunAt?: Date; lastRunId?: string | null; lastAssignmentId?: string; lastError?: string | null },
  ): void {
    const db = getDb();
    db.update(pulses)
      .set({
        lastRunAt: fields.lastRunAt,
        nextRunAt: fields.nextRunAt,
        lastRunId: fields.lastRunId ?? null,
        lastAssignmentId: fields.lastAssignmentId,
        lastError: fields.lastError ?? null,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(pulses.id, id))
      .run();
  },
};
