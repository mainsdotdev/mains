import { eq, sql, and, lte } from "drizzle-orm";
import { getDb } from "../../db/client";
import { automations, automationRuns } from "../../db/schema";
import type { CreateAutomationInput, UpdateAutomationInput } from "./automations.dto";
import { nanoid } from "nanoid";

// ─────────────────────────────────────────────────────────────
// Repository - Database queries
// ─────────────────────────────────────────────────────────────
export const automationsRepo = {
  findAll() {
    const db = getDb();
    return db.select().from(automations).all();
  },

  findActive() {
    const db = getDb();
    return db.select().from(automations).where(eq(automations.isActive, true)).all();
  },

  findById(id: string) {
    const db = getDb();
    return db.select().from(automations).where(eq(automations.id, id)).get();
  },

  findDue(now: Date) {
    const db = getDb();
    return db
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.isActive, true),
          lte(automations.nextRunAt, now),
        ),
      )
      .all();
  },

  create(accountId: string, input: CreateAutomationInput) {
    const db = getDb();
    const id = nanoid();
    const now = new Date();
    const nextRunAt = new Date(now.getTime() + input.intervalMinutes * 60_000);

    db.insert(automations)
      .values({
        id,
        accountId,
        name: input.name,
        kind: input.kind,
        action: input.action,
        intervalMinutes: input.intervalMinutes,
        isActive: input.isActive ?? true,
        config: input.config ?? null,
        nextRunAt,
        consecutiveErrors: 0,
      })
      .run();

    return this.findById(id)!;
  },

  update(id: string, input: UpdateAutomationInput) {
    const db = getDb();
    const updates: Record<string, any> = { ...input, updatedAt: sql`(unixepoch())` };

    // Recalculate nextRunAt when interval changes
    if (input.intervalMinutes !== undefined) {
      updates.nextRunAt = new Date(Date.now() + input.intervalMinutes * 60_000);
    }

    db.update(automations)
      .set(updates)
      .where(eq(automations.id, id))
      .run();

    return this.findById(id);
  },

  delete(id: string) {
    const db = getDb();
    db.delete(automations).where(eq(automations.id, id)).run();
  },

  markRunCompleted(id: string, error?: string) {
    const db = getDb();
    const automation = this.findById(id);
    if (!automation) return;

    const now = new Date();
    const nextRunAt = new Date(now.getTime() + automation.intervalMinutes * 60_000);

    db.update(automations)
      .set({
        lastRunAt: now,
        nextRunAt,
        lastError: error ?? null,
        consecutiveErrors: error ? automation.consecutiveErrors + 1 : 0,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(automations.id, id))
      .run();
  },

  // ── Automation Runs ──

  createRun(automationId: string) {
    const db = getDb();
    const id = nanoid();

    db.insert(automationRuns)
      .values({
        id,
        automationId,
        status: "running",
      })
      .run();

    return id;
  },

  completeRun(runId: string, status: "success" | "error", result?: string, error?: string) {
    const db = getDb();
    const now = new Date();

    // Get the run to calculate duration
    const run = db.select().from(automationRuns).where(eq(automationRuns.id, runId)).get();
    const durationMs = run?.startedAt ? now.getTime() - new Date(run.startedAt).getTime() : 0;

    db.update(automationRuns)
      .set({
        status,
        result: result ?? null,
        error: error ?? null,
        completedAt: now,
        durationMs,
      })
      .where(eq(automationRuns.id, runId))
      .run();
  },

  getRunsByAutomation(automationId: string, limit = 20) {
    const db = getDb();
    return db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, automationId))
      .orderBy(sql`${automationRuns.startedAt} DESC`)
      .limit(limit)
      .all();
  },
};
