import { assertOwnedRecord } from "../bridge";
import { createSchedulerLifecycle } from "../../runtime/scheduler-lifecycle";
import { pulseRepo } from "./pulse.repo";
import { validateCreate, validateUpdate } from "./pulse.validation";
import { runsService } from "../runs/runs.service";
import { appSettingsService } from "../appSettings";
import { spaceService } from "../space";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { createHash, randomUUID } from "node:crypto";
import { assistantsService } from "../assistants";
import { computeRoutineNextRunAt } from "./routine-schedule";
import type {
  CreatePulseInput,
  CreateAssistantRoutineInput,
  Pulse,
  PulseFrequency,
  UpdatePulseInput,
} from "./pulse.dto";

// Pulse forces these provider-specific permission/sandbox/mode values per user spec.
function buildConfigSnapshot(
  providerId: string,
  pulse: Pick<Pulse, "thinkingMode" | "effortLevel">,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};

  switch (providerId) {
    case PROVIDER_IDS.claude:
      snapshot.permissionMode = "auto";
      snapshot.thinkingMode = pulse.thinkingMode;
      if (pulse.effortLevel) snapshot.effortLevel = pulse.effortLevel;
      break;
    case PROVIDER_IDS.codex:
      snapshot.sandboxMode = "workspace-write";
      if (pulse.effortLevel) snapshot.modelReasoningEffort = pulse.effortLevel;
      break;
    case PROVIDER_IDS.copilot:
      snapshot.permissionMode = "allow";
      if (pulse.effortLevel) snapshot.modelReasoningEffort = pulse.effortLevel;
      break;
    case PROVIDER_IDS.cursor:
      snapshot.mode = "agent";
      if (pulse.effortLevel) snapshot.effortLevel = pulse.effortLevel;
      break;
    case PROVIDER_IDS.opencode:
      snapshot.agent = "build";
      if (pulse.effortLevel) snapshot.effortLevel = pulse.effortLevel;
      break;
  }

  return snapshot;
}

// ─────────────────────────────────────────────────────────────
// Pure scheduling math
// ─────────────────────────────────────────────────────────────

type ScheduleSpec = {
  frequency: PulseFrequency;
  dayOfWeek?: number | null;
  hour: number;
  minute: number;
};

/**
 * Returns the next firing time strictly after `from` for the given schedule.
 * Uses local time (the device timezone). `timezone` is captured for display.
 */
export function computeNextRunAt(spec: ScheduleSpec, from: Date): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);

  switch (spec.frequency) {
    case "hourly": {
      next.setMinutes(spec.minute);
      if (next <= from) next.setHours(next.getHours() + 1);
      return next;
    }
    case "daily": {
      next.setHours(spec.hour, spec.minute, 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      return next;
    }
    case "weekdays": {
      next.setHours(spec.hour, spec.minute, 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }
    case "weekly": {
      const target = spec.dayOfWeek ?? 1; // default Monday
      next.setHours(spec.hour, spec.minute, 0, 0);
      const diff = (target - next.getDay() + 7) % 7;
      if (diff === 0 && next <= from) {
        next.setDate(next.getDate() + 7);
      } else {
        next.setDate(next.getDate() + diff);
      }
      return next;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// In-memory single-timer scheduler
// ─────────────────────────────────────────────────────────────

const lifecycle = createSchedulerLifecycle<Pulse>();
const nextTime = (pulse: CreatePulseInput, from: Date) => pulse.assistantId ? computeRoutineNextRunAt(pulse, from) : computeNextRunAt(pulse, from);

function routineProfile(accountId: string, input: CreatePulseInput): CreatePulseInput {
  if (input.assistantId != null && !input.assistantId.trim()) throw new Error("Assistant is required");
  if (!input.assistantId) return input;
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") throw new Error("Routine activity must be true or false");
  const assistant = assistantsService.require(input.assistantId, accountId);
  if (input.collectionId) throw new Error("Assistant routines do not target a collection");
  if (input.mode === "chat") throw new Error("Assistant routines run in Work or Developer mode");
  if (input.title?.length > 200 || input.prompt?.length > 24_000) throw new Error("Routine names allow 200 characters and tasks allow 24000 characters");
  if (!Number.isInteger(input.hour) || !Number.isInteger(input.minute) || input.dayOfWeek != null && !Number.isInteger(input.dayOfWeek)) throw new Error("Choose a valid routine time");
  if (input.workspaceId) {
    const workspace = pulseRepo.routineWorkspace(input.workspaceId);
    if (!workspace || workspace.accountId !== accountId || workspace.isArchived) throw new Error("Workspace is unavailable");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(); }
  catch { throw new Error("Choose a valid routine timezone"); }
  return { ...input, mode: input.mode ?? (input.workspaceId ? "developer" : "work"), providerId: assistant.providerId, model: assistant.model, effortLevel: assistant.effort || null, thinkingMode: false };
}

function clearNextTimer() {
  lifecycle.cancel("next");
}

function scheduleNext() {
  clearNextTimer();
  if (!lifecycle.running) return;
  const next = pulseRepo.findNextScheduled();
  if (!next || !next.nextRunAt) return;

  lifecycle.schedule("next", Math.max(new Date(next.nextRunAt).getTime(), lifecycle.retryAt(next.id)), () => {
    pulseService.tick().catch((err) => console.error("[Pulse] tick failed:", err));
  });
}

// ─────────────────────────────────────────────────────────────
// Service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// See CONTEXT.md "handle" / "absence rule".
// ─────────────────────────────────────────────────────────────

export const pulseService = {
  start(): void {
    if (!lifecycle.start()) return;

    // Catch-up: any active pulse with nextRunAt in the past — fire once,
    // then re-schedule normally.
    const due = pulseRepo.findDueActive(new Date());
    if (due.length > 0) {
      console.log(`[Pulse] catching up ${due.length} missed pulse(s)`);
    }
    for (const pulse of due) {
      this.executePulse(pulse.id).catch((err) =>
        console.error(`[Pulse] catch-up failed for ${pulse.id}:`, err),
      );
    }

    scheduleNext();
  },

  stop(): Promise<void> {
    clearNextTimer();
    return lifecycle.stop();
  },

  // ── CRUD ──

  getAll(): Pulse[] {
    return pulseRepo.findAll();
  },

  getById(id: string): Pulse | null {
    return pulseRepo.findById(id) ?? null;
  },

  /** The active pulse due soonest — what the scheduler's timer is waiting on. */
  getNextScheduled(): Pulse | null {
    return pulseRepo.findNextScheduled() ?? null;
  },

  create(accountId: string, input: CreatePulseInput, requestKey?: string): Pulse {
    input = routineProfile(accountId, input);
    const validationError = validateCreate(input);
    if (validationError) throw new Error(validationError);

    if (input.workspaceId) assertOwnedRecord("workspaces", input.workspaceId);
    const id = requestKey ? `routine-${createHash("sha256").update(JSON.stringify([accountId, input.assistantId, requestKey])).digest("hex")}` : undefined;
    const existing = id ? pulseRepo.findById(id) : undefined;
    if (existing) {
      assertOwnedRecord("pulses", existing.id);
      if (existing.accountId !== accountId || existing.assistantId !== input.assistantId) throw new Error("Routine request belongs to another assistant");
      for (const key of ["title", "prompt", "frequency", "hour", "minute", "timezone", "mode"] as const) {
        if (existing[key] !== input[key]) throw new Error("This routine request already exists with different settings. Read and update it instead.");
      }
      if (existing.workspaceId !== (input.workspaceId ?? null) || existing.dayOfWeek !== (input.dayOfWeek ?? null) || existing.isActive !== (input.isActive ?? true)) throw new Error("This routine request already exists with different settings. Read and update it instead.");
      return existing;
    }
    const nextRunAt = nextTime(input, new Date());
    const pulse = pulseRepo.create(accountId, input, nextRunAt, id);
    scheduleNext();
    return pulse;
  },

  createRoutine(accountId: string, assistantId: string, input: CreateAssistantRoutineInput, requestKey?: string): Pulse {
    if (!assistantId?.trim()) throw new Error("Assistant is required");
    // A distinct command prevents older backends from silently creating an unbound Pulse.
    return this.create(accountId, { ...input, assistantId, providerId: "", model: "" }, requestKey);
  },

  forAssistant(accountId: string, assistantId: string, offset = 0): Pulse[] {
    assistantsService.require(assistantId, accountId);
    return pulseRepo.findForAssistant(accountId, assistantId, offset);
  },

  update(id: string, input: UpdatePulseInput): Pulse | null {
    assertOwnedRecord("pulses", id);
    const existing = pulseRepo.findById(id);
    if (!existing) throw new Error("Pulse not found");
    if ("assistantId" in input || "mode" in input) throw new Error("A pulse keeps its original assistant and mode");
    const allowed = new Set(["workspaceId", "collectionId", "providerId", "model", "title", "prompt", "frequency", "dayOfWeek", "hour", "minute", "timezone", "thinkingMode", "effortLevel", "isActive"]);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new Error("Unknown pulse setting");
    if (existing.assistantId) {
      if (input.isActive !== undefined && typeof input.isActive !== "boolean") throw new Error("Routine activity must be true or false");
      if (input.isActive !== false) assistantsService.require(existing.assistantId, existing.accountId);
      for (const key of ["providerId", "model", "effortLevel", "thinkingMode", "collectionId"] as const) {
        if (input[key] !== undefined && input[key] !== existing[key]) throw new Error("This routine uses its assistant's fixed profile");
      }
      if (input.timezone !== undefined) {
        try { new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(); }
        catch { throw new Error("Choose a valid routine timezone"); }
      }
      if (input.workspaceId) {
        const workspace = pulseRepo.routineWorkspace(input.workspaceId);
        if (!workspace || workspace.accountId !== existing.accountId || workspace.isArchived) throw new Error("Workspace is unavailable");
      }
      if (input.title != null && input.title.length > 200 || input.prompt != null && input.prompt.length > 24_000) throw new Error("Routine names allow 200 characters and tasks allow 24000 characters");
      if (input.hour != null && !Number.isInteger(input.hour) || input.minute != null && !Number.isInteger(input.minute) || input.dayOfWeek != null && !Number.isInteger(input.dayOfWeek)) throw new Error("Choose a valid routine time");
    }

    if (input.workspaceId) assertOwnedRecord("workspaces", input.workspaceId);
    const merged = { ...existing, ...input };
    const validationError = validateUpdate(merged);
    if (validationError) throw new Error(validationError);
    if (existing.assistantId) {
      const routineError = validateCreate(merged);
      if (routineError) throw new Error(routineError);
    }

    // Recompute nextRunAt if any scheduling field changed
    const scheduleChanged =
      input.frequency !== undefined ||
      input.hour !== undefined ||
      input.minute !== undefined ||
      input.dayOfWeek !== undefined ||
      !!existing.assistantId && input.timezone !== undefined ||
      input.isActive === true && !existing.isActive;

    // Mode is fixed at creation; an update must keep the target shape
    // consistent with it (developer ⇄ workspace, work/chat ⇄ collection).
    if (merged.mode === "developer") {
      if (!merged.workspaceId) throw new Error("workspaceId is required");
      if (merged.collectionId) {
        throw new Error("collectionId is only allowed for work/chat pulses");
      }
    } else if (merged.workspaceId) {
      throw new Error("workspaceId is only allowed for developer pulses");
    }
    const nextRunAt = scheduleChanged
      ? nextTime(merged, new Date())
      : undefined;

    const pulse = pulseRepo.update(id, input, nextRunAt);
    lifecycle.invalidate(id);
    scheduleNext();
    return pulse ?? null;
  },

  delete(id: string): void {
    assertOwnedRecord("pulses", id);
    pulseRepo.delete(id);
    lifecycle.invalidate(id);
    scheduleNext();
  },

  toggle(id: string, isActive: boolean): Pulse | null {
    return this.update(id, { isActive });
  },

  pauseAssistantRoutines(assistantId: string): void {
    for (const id of pulseRepo.pauseAssistantRoutines(assistantId)) lifecycle.invalidate(id);
    scheduleNext();
  },

  // ── Execution ──

  async executePulse(id: string, manualTaskKey?: string): Promise<Pulse | null> {
    return lifecycle.run(id, async (current) => {
      assertOwnedRecord("pulses", id);
      const pulse = pulseRepo.findById(id);
      if (!pulse) throw new Error("Pulse not found");

      const now = new Date();
      const nextRunAt = nextTime(pulse, now);

      // Claim the pulse synchronously BEFORE awaiting anything so that a
      // concurrent scheduleNext()/tick() pass cannot see it as still due
      // and fire a duplicate run. (See: catch-up race in start().)
      pulseRepo.claimNextRun(id, nextRunAt);

      let launched = false;
      try {
        if (pulse.assistantId) {
          const { assistantWork } = await import("../assistants");
          if (!current()) return null;
          assistantsService.require(pulse.assistantId, pulse.accountId);
          const previous = pulse.lastAssignmentId ? assistantsService.assignment(pulse.accountId, pulse.lastAssignmentId) : null;
          if (previous && !["completed", "failed", "canceled"].includes(previous.status)) {
            throw new Error("The previous routine task is still open. Review it before starting another run.");
          }
          const occurrence = pulse.nextRunAt?.getTime() ?? now.getTime();
          const task = await assistantWork.assign({
            accountId: pulse.accountId, toAssistantId: pulse.assistantId,
            taskKey: manualTaskKey ?? `pulse:${pulse.id}:${occurrence}`,
            title: pulse.title, prompt: pulse.prompt,
            execution: pulse.mode === "developer" ? { mode: "developer", workspaceId: pulse.workspaceId } : { mode: "work" },
          }, undefined, () => { if (!current()) throw new Error("Routine changed before dispatch"); });
          launched = true;
          pulseRepo.markRun(id, { lastRunAt: now, nextRunAt: current() ? nextRunAt : undefined, lastAssignmentId: task.id, lastError: null });
          return pulseRepo.findById(id) ?? null;
        }
        const settings = await appSettingsService.getSettings();
        if (!current()) return null;
        const configSnapshot = buildConfigSnapshot(pulse.providerId, pulse);
        // The run must execute under a space of the pulse's own mode — a work
        // digest must not inherit the developer harness (or vice versa). Prefer
        // the active space when it matches, else any live space of that pair.
        const spaces = await spaceService.getAll();
        if (!current()) return null;
        const activeSpace = settings.activeSpaceId
          ? spaces.find((space) => space.id === settings.activeSpaceId)
          : undefined;
        const matchesPulse = (space: (typeof spaces)[number]) =>
          space.providerId === pulse.providerId &&
          space.mode === pulse.mode &&
          !space.isArchived;
        const runSpace =
          activeSpace && matchesPulse(activeSpace)
            ? activeSpace
            : spaces.find(matchesPulse);
        if (!runSpace) {
          throw new Error(
            `No ${pulse.mode} space is available for provider "${pulse.providerId}"`,
          );
        }

        launched = true;
        const result = await runsService.executeRun({
          accountId: pulse.accountId,
          // Developer pulses run in their workspace; work/chat pulses run
          // workspace-less (managed execution dir) with an optional collection,
          // whose sources travel into the run like any collection chat.
          workspaceId: pulse.workspaceId ?? undefined,
          collectionId: pulse.collectionId ?? undefined,
          spaceId: runSpace.id,
          providerId: pulse.providerId,
          model: pulse.model,
          goal: pulse.prompt,
          configSnapshot,
        });

        pulseRepo.markRun(id, {
          lastRunAt: now,
          nextRunAt: current() ? nextRunAt : undefined,
          lastRunId: result.runId,
          lastError: null,
        });
        return pulseRepo.findById(id) ?? null;
      } catch (err: any) {
        if (!launched && !current()) return null;
        const message = err?.message ?? String(err);
        pulseRepo.markRun(id, { lastRunAt: now, nextRunAt: current() ? nextRunAt : undefined, lastError: message });
        throw err instanceof Error ? err : new Error(message);
      } finally {
        if (!launched && !current()) pulseRepo.releaseClaim(id, nextRunAt, pulse.nextRunAt);
      }
    }, scheduleNext);
  },

  async runNow(id: string): Promise<Pulse | null> {
    return this.executePulse(id, `pulse:${id}:manual:${randomUUID()}`);
  },

  async tick(): Promise<void> {
    const current = lifecycle.capture();
    if (!current()) return;
    const due = pulseRepo.findDueActive(new Date());
    for (const pulse of due) {
      if (!current()) return;
      const latest = pulseRepo.findById(pulse.id);
      if (!latest?.isActive || !latest.nextRunAt || latest.nextRunAt.getTime() > Date.now()) continue;
      // One failing pulse must not starve the rest of the due list; the
      // failure is already recorded on the row (lastError) by executePulse.
      try {
        await this.executePulse(pulse.id);
      } catch (err) {
        console.error(`[Pulse] execute failed for ${pulse.id}:`, err);
      }
    }
    scheduleNext();
  },
};
