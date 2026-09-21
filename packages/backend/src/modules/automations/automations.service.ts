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
const timers = new Map<string, NodeJS.Timeout>();

function scheduleNext(automation: Automation) {
  // Clear existing timer
  const existing = timers.get(automation.id);
  if (existing) clearTimeout(existing);

  if (!automation.isActive) return;

  const now = Date.now();
  const nextRun = automation.nextRunAt
    ? new Date(automation.nextRunAt).getTime()
    : now + automation.intervalMinutes * 60_000;

  const delay = Math.max(0, nextRun - now);

  const timer = setTimeout(() => {
    automationsService.executeAutomation(automation.id).catch((err) => {
      console.error(`Automation ${automation.id} failed:`, err);
    });
  }, delay);

  timers.set(automation.id, timer);
}

function cancelTimer(automationId: string) {
  const timer = timers.get(automationId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(automationId);
  }
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
    const active = automationsRepo.findActive();
    console.log(`Automations: scheduling ${active.length} active automation(s)`);
    for (const a of active) {
      scheduleNext(a);
    }
  },

  stop() {
    for (const [id] of timers) {
      cancelTimer(id);
    }
    timers.clear();
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

    // Reschedule or cancel
    if (automation.isActive) {
      scheduleNext(automation);
    } else {
      cancelTimer(id);
    }

    return automation;
  },

  delete(id: string): void {
    cancelTimer(id);
    automationsRepo.delete(id);
  },

  // ── Execution ──

  async executeAutomation(id: string): Promise<AutomationRun | null> {
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
      automationsRepo.markRunCompleted(id);

      // Schedule next run
      const updated = automationsRepo.findById(id);
      if (updated) scheduleNext(updated);

      const runs = automationsRepo.getRunsByAutomation(id, 1);
      return runs[0] ?? null;
    } catch (err: any) {
      const errorMsg = err.message || "Unknown error";
      automationsRepo.completeRun(runId, "error", undefined, errorMsg);
      automationsRepo.markRunCompleted(id, errorMsg);

      // Schedule next run even on error
      const updated = automationsRepo.findById(id);
      if (updated) scheduleNext(updated);

      const runs = automationsRepo.getRunsByAutomation(id, 1);
      return runs[0] ?? null;
    }
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
