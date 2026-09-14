import { pulseRepo } from "./pulse.repo";
import { validateCreate, validateUpdate } from "./pulse.validation";
import { runsService } from "../runs/runs.service";
import { appSettingsService } from "../appSettings";
import { spaceService } from "../space";
import { PROVIDER_IDS } from "../../../shared/provider-ids";
import type {
  CreatePulseInput,
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

let nextTimer: NodeJS.Timeout | null = null;
let started = false;

function clearNextTimer() {
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
}

function scheduleNext() {
  clearNextTimer();
  const next = pulseRepo.findNextScheduled();
  if (!next || !next.nextRunAt) return;

  const delay = Math.max(0, new Date(next.nextRunAt).getTime() - Date.now());
  nextTimer = setTimeout(() => {
    pulseService.tick().catch((err) => console.error("[Pulse] tick failed:", err));
  }, delay);
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
    if (started) return;
    started = true;

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

  stop(): void {
    clearNextTimer();
    started = false;
  },

  // ── CRUD ──

  getAll(): Pulse[] {
    return pulseRepo.findAll();
  },

  getById(id: string): Pulse | null {
    return pulseRepo.findById(id) ?? null;
  },

  create(accountId: string, input: CreatePulseInput): Pulse {
    const validationError = validateCreate(input);
    if (validationError) throw new Error(validationError);

    const nextRunAt = computeNextRunAt(input, new Date());
    const pulse = pulseRepo.create(accountId, input, nextRunAt);
    scheduleNext();
    return pulse;
  },

  update(id: string, input: UpdatePulseInput): Pulse | null {
    const validationError = validateUpdate(input);
    if (validationError) throw new Error(validationError);

    const existing = pulseRepo.findById(id);
    if (!existing) throw new Error("Pulse not found");

    // Recompute nextRunAt if any scheduling field changed
    const scheduleChanged =
      input.frequency !== undefined ||
      input.hour !== undefined ||
      input.minute !== undefined ||
      input.dayOfWeek !== undefined;

    const merged = { ...existing, ...input };
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
      ? computeNextRunAt(merged, new Date())
      : undefined;

    const pulse = pulseRepo.update(id, input, nextRunAt);
    scheduleNext();
    return pulse ?? null;
  },

  delete(id: string): void {
    pulseRepo.delete(id);
    scheduleNext();
  },

  toggle(id: string, isActive: boolean): Pulse | null {
    return this.update(id, { isActive });
  },

  // ── Execution ──

  async executePulse(id: string): Promise<Pulse | null> {
    const pulse = pulseRepo.findById(id);
    if (!pulse) throw new Error("Pulse not found");

    const now = new Date();
    const nextRunAt = computeNextRunAt(pulse, now);

    // Claim the pulse synchronously BEFORE awaiting anything so that a
    // concurrent scheduleNext()/tick() pass cannot see it as still due
    // and fire a duplicate run. (See: catch-up race in start().)
    pulseRepo.claimNextRun(id, nextRunAt);

    try {
      const settings = await appSettingsService.getSettings();
      const configSnapshot = buildConfigSnapshot(pulse.providerId, pulse);
      // The run must execute under a space of the pulse's own mode — a work
      // digest must not inherit the developer harness (or vice versa). Prefer
      // the active space when it matches, else any live space of that pair.
      const spaces = await spaceService.getAll();
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
        nextRunAt,
        lastRunId: result.runId,
        lastError: null,
      });
      scheduleNext();
      return pulseRepo.findById(id) ?? null;
    } catch (err: any) {
      const message = err?.message ?? String(err);
      pulseRepo.markRun(id, { lastRunAt: now, nextRunAt, lastError: message });
      scheduleNext();
      throw err instanceof Error ? err : new Error(message);
    }
  },

  async runNow(id: string): Promise<Pulse | null> {
    return this.executePulse(id);
  },

  async tick(): Promise<void> {
    const due = pulseRepo.findDueActive(new Date());
    for (const pulse of due) {
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
