import { assertOwnedRecord } from "../bridge";
import { createSchedulerLifecycle } from "../../runtime/scheduler-lifecycle";
import { automationsRepo } from "./automations.repo";
import { syncService } from "../sync/sync.service";
import type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "./automations.dto";

// ─────────────────────────────────────────────────────────────
// Action Registry — maps action strings to executable functions
// ─────────────────────────────────────────────────────────────
type ActionHandler = (config?: string | null) => Promise<string | null>;

const actionHandlers: Record<string, ActionHandler> = {
  "sync:all": async () => {
    return JSON.stringify(await syncService.runEntitySync());
  },

  "sync:github": async () => {
    return JSON.stringify(await syncService.runEntitySync("github"));
  },

  "sync:gitlab": async () => {
    return JSON.stringify(await syncService.runEntitySync("gitlab"));
  },

  "sync:linear": async () => {
    return JSON.stringify(await syncService.runEntitySync("linear"));
  },

  "sync:jira": async () => {
    return JSON.stringify(await syncService.runEntitySync("jira"));
  },

  "sync:asana": async () => {
    return JSON.stringify(await syncService.runEntitySync("asana"));
  },

  "sync:trello": async () => {
    return JSON.stringify(await syncService.runEntitySync("trello"));
  },

  "sync:notion": async () => {
    return JSON.stringify(await syncService.runEntitySync("notion"));
  },

  "sync:sentry": async () => {
    return JSON.stringify(await syncService.runEntitySync("sentry"));
  },
};

// ─────────────────────────────────────────────────────────────
// Scheduler — in-memory timer manager
// ─────────────────────────────────────────────────────────────
const lifecycle = createSchedulerLifecycle<AutomationRun>();

function scheduleNext(automation: Automation) {
  // Clear existing timer
  lifecycle.cancel(automation.id);

  if (!lifecycle.running || !automation.isActive) return;

  const now = Date.now();
  const nextRun = automation.nextRunAt
    ? new Date(automation.nextRunAt).getTime()
    : now + automation.intervalMinutes * 60_000;

  lifecycle.schedule(automation.id, nextRun, () => {
    automationsService.executeAutomation(automation.id).catch((err) => {
      console.error(`Automation ${automation.id} failed:`, err);
    });
  });
}

function cancelTimer(automationId: string) {
  lifecycle.cancel(automationId);
}

// ─────────────────────────────────────────────────────────────
// Service — Business logic
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// ─────────────────────────────────────────────────────────────
export const automationsService = {
  // ── Lifecycle ──

  start() {
    if (!lifecycle.start()) return;
    const active = automationsRepo.findActive();
    console.log(`Automations: scheduling ${active.length} active automation(s)`);
    for (const a of active) {
      scheduleNext(a);
    }
  },

  stop() {
    return lifecycle.stop();
  },

  // ── CRUD ──

  getAll(): Automation[] {
    return automationsRepo.findAll();
  },

  getById(id: string): Automation | null {
    return automationsRepo.findById(id) ?? null;
  },

  create(accountId: string, input: CreateAutomationInput): Automation {
    if (!actionHandlers[input.action]) {
      throw new Error(`Unknown action: ${input.action}`);
    }
    if (input.intervalMinutes < 1) {
      throw new Error("Interval must be at least 1 minute");
    }

    const automation = automationsRepo.create(accountId, input);
    scheduleNext(automation);

    return automation;
  },

  update(id: string, input: UpdateAutomationInput): Automation {
    assertOwnedRecord("automations", id);
    if (input.action && !actionHandlers[input.action]) {
      throw new Error(`Unknown action: ${input.action}`);
    }
    if (input.intervalMinutes !== undefined && input.intervalMinutes < 1) {
      throw new Error("Interval must be at least 1 minute");
    }

    const automation = automationsRepo.update(id, input);
    if (!automation) {
      throw new Error("Automation not found");
    }

    lifecycle.invalidate(id);
    // Reschedule or cancel
    if (automation.isActive) {
      scheduleNext(automation);
    } else {
      cancelTimer(id);
    }

    return automation;
  },

  delete(id: string): void {
    assertOwnedRecord("automations", id);
    cancelTimer(id);
    automationsRepo.delete(id);
    lifecycle.invalidate(id);
  },

  // ── Execution ──

  async executeAutomation(id: string): Promise<AutomationRun | null> {
    return lifecycle.run(id, async () => {
      assertOwnedRecord("automations", id);
      const automation = automationsRepo.findById(id);
      if (!automation) {
        throw new Error("Automation not found");
      }

      const handler = actionHandlers[automation.action];
      if (!handler) {
        throw new Error(`No handler for action: ${automation.action}`);
      }

      const runId = automationsRepo.createRun(id);

      try {
        const result = await handler(automation.config);
        automationsRepo.completeRun(runId, "success", result ?? undefined);
        automationsRepo.markRunCompleted(id, undefined, automation.nextRunAt);

        const runs = automationsRepo.getRunsByAutomation(id, 1);
        return runs[0] ?? null;
      } catch (err: any) {
        const errorMsg = err.message || "Unknown error";
        automationsRepo.completeRun(runId, "error", undefined, errorMsg);
        automationsRepo.markRunCompleted(id, errorMsg, automation.nextRunAt);

        const runs = automationsRepo.getRunsByAutomation(id, 1);
        return runs[0] ?? null;
      }
    }, () => {
      const updated = automationsRepo.findById(id);
      if (updated) scheduleNext(updated);
    });
  },

  // ── Run History ──

  getRunHistory(automationId: string, limit = 20): AutomationRun[] {
    return automationsRepo.getRunsByAutomation(automationId, limit);
  },

  // ── Helpers ──

  getAvailableActions(): string[] {
    return Object.keys(actionHandlers);
  },

  registerAction(action: string, handler: ActionHandler) {
    actionHandlers[action] = handler;
  },
};
