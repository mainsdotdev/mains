import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../test/setup-db";
import { createRun } from "../../test/factories";

let fixture: ReturnType<typeof createTestDb>;
vi.mock("../db/client", () => ({ getDb: () => fixture.db, getSqlite: () => fixture.sqlite }));
vi.mock("../modules/runs/runs.service", () => ({ runsService: { executeRun: vi.fn() } }));
vi.mock("../modules/sync/sync.service", () => ({ syncService: { runEntitySync: vi.fn() } }));

import { pulseService } from "../modules/pulse/pulse.service";
import { automationsService } from "../modules/automations/automations.service";
import { runsService } from "../modules/runs/runs.service";
import { spaceService } from "../modules/space";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function pulse() {
  return pulseService.create("default", { mode: "work", providerId: "claude_code", model: "sonnet", title: "Digest", prompt: "Summarize",
    frequency: "hourly", hour: 9, minute: 30, timezone: "UTC" });
}
function makePulsesDue() {
  // SQLite's unixepoch() uses the real clock, independent of Vitest's Date.
  fixture.sqlite.prepare("UPDATE pulses SET next_run_at=?").run(Math.floor(Date.now() / 1000) - 1);
}
function automation(handler: () => Promise<string | null>, intervalMinutes = 1) {
  automationsService.registerAction("test:scheduled", handler);
  return automationsService.create("default", { name: "Scheduled test", kind: "custom", action: "test:scheduled", intervalMinutes });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(2026, 10, 9, 8, 0, 0));
  fixture = createTestDb();
  fixture.sqlite.exec("INSERT INTO accounts(id) VALUES('default'); INSERT INTO app_settings(id,account_id,backend_id) VALUES('default','default','A'); INSERT INTO providers(id,kind,display_name) VALUES('claude_code','agent_runtime','Claude'); INSERT INTO spaces(id,account_id,name,slug,provider_id,mode) VALUES('work','default','Work','work','claude_code','work')");
  vi.mocked(runsService.executeRun).mockImplementation(async () => ({ runId: createRun(fixture.db, { providerId: "claude_code", mode: "work" }).id }));
  pulseService.start(); automationsService.start();
});
afterEach(async () => {
  await Promise.all([pulseService.stop(), automationsService.stop()]);
  fixture.cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.clearAllTimers(); vi.useRealTimers();
});

describe("Scheduled execution through real SQLite services", () => {
  it("records a finished automation without postponing a schedule changed during execution", async () => {
    const entered = deferred<void>(), gate = deferred<void>();
    const saved = automation(async () => { entered.resolve(); await gate.promise; return '{"ok":true}'; });
    const executing = automationsService.executeAutomation(saved.id); await entered.promise;
    const updated = automationsService.update(saved.id, { intervalMinutes: 5 });
    await vi.advanceTimersByTimeAsync(10_000); gate.resolve(); await executing;
    expect(automationsService.getById(saved.id)?.nextRunAt).toEqual(updated.nextRunAt);
    expect(automationsService.getRunHistory(saved.id)[0].status).toBe("success");
  });

  it("records an action failure and resumes automation scheduling at the next interval", async () => {
    const action = vi.fn(async () => '{"ok":true}').mockRejectedValueOnce(new Error("Temporary sync failure"));
    const saved = automation(action);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(automationsService.getRunHistory(saved.id)[0]).toMatchObject({ status: "error", error: "Temporary sync failure" });
    expect(automationsService.getById(saved.id)?.consecutiveErrors).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(action).toHaveBeenCalledTimes(2);
    expect(automationsService.getById(saved.id)).toMatchObject({ consecutiveErrors: 0, lastError: null });
  });

  it("keeps other due Pulses moving after one launch fails and retries on its next slot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = pulse(), second = pulse();
    pulseService.update(first.id, { prompt: "fail once" });
    makePulsesDue();
    let failed = false;
    vi.mocked(runsService.executeRun).mockImplementation(async (input) => {
      if (input.goal === "fail once" && !failed) { failed = true; throw new Error("Temporary provider failure"); }
      return { runId: createRun(fixture.db, { providerId: "claude_code", mode: "work" }).id };
    });
    await pulseService.tick();
    expect(runsService.executeRun).toHaveBeenCalledTimes(2);
    expect(pulseService.getById(first.id)?.lastError).toBe("Temporary provider failure");
    expect(pulseService.getById(second.id)?.lastRunId).toBeTruthy();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(pulseService.getById(first.id)).toMatchObject({ lastError: null, lastRunId: expect.any(String) });
  });

  it.each(["delete", "disable"])("retires an admitted automation before dispatch on %s", async (change) => {
    const action = vi.fn(async () => '{"ok":true}'), saved = automation(action);
    const executing = automationsService.executeAutomation(saved.id);
    if (change === "delete") automationsService.delete(saved.id);
    else automationsService.update(saved.id, { isActive: false });
    await executing;
    expect(action).not.toHaveBeenCalled();
    if (change === "disable") {
      await automationsService.executeAutomation(saved.id);
      expect(action).toHaveBeenCalledOnce();
    }
  });

  it("ignores a late Pulse tick after shutdown has closed SQLite", async () => {
    await pulseService.stop(); fixture.sqlite.close();
    await expect(pulseService.tick()).resolves.toBeUndefined();
  });

  it("keeps a canceled scheduled Pulse due for catch-up after restart", async () => {
    const saved = pulse(), entered = deferred<void>(), gate = deferred<void>(), getAll = spaceService.getAll.bind(spaceService);
    makePulsesDue();
    vi.spyOn(spaceService, "getAll").mockImplementationOnce(async () => {
      const spaces = await getAll(); entered.resolve(); await gate.promise; return spaces;
    });
    const ticking = pulseService.tick(); await entered.promise;
    const stopping = pulseService.stop(); gate.resolve(); await ticking; await stopping;
    pulseService.start(); await vi.advanceTimersByTimeAsync(0);
    expect(runsService.executeRun).toHaveBeenCalledOnce();
    expect(pulseService.getById(saved.id)?.lastRunId).toBeTruthy();
  });

  it("retries a failed automation receipt without running its action or stranding its timer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const action = vi.fn(async () => '{"ok":true}'), saved = automation(action);
    fixture.sqlite.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON automation_runs BEGIN SELECT RAISE(ABORT,'Injected receipt failure'); END");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(action).not.toHaveBeenCalled(); expect(automationsService.getRunHistory(saved.id)).toEqual([]);
    await vi.advanceTimersByTimeAsync(900);
    fixture.sqlite.exec("DROP TRIGGER fail_receipt");
    await vi.advanceTimersByTimeAsync(100);
    expect(action).toHaveBeenCalledOnce();
    expect(automationsService.getRunHistory(saved.id)[0].status).toBe("success");
  });

  it("waits for a long automation interval instead of overflowing the Node timer", async () => {
    const action = vi.fn(async () => '{"ok":true}'), interval = 30 * 24 * 60 * 60_000;
    automation(action, 30 * 24 * 60);
    await vi.advanceTimersByTimeAsync(1); expect(action).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(interval - 2); expect(action).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(action).toHaveBeenCalledOnce();
  });

  it("preserves a newer Pulse schedule while recording an already accepted launch", async () => {
    const saved = pulse(), entered = deferred<void>(), gate = deferred<void>();
    vi.mocked(runsService.executeRun).mockImplementation(async () => {
      const runId = createRun(fixture.db, { providerId: "claude_code", mode: "work" }).id;
      entered.resolve(); await gate.promise; return { runId };
    });
    const executing = pulseService.runNow(saved.id); await entered.promise;
    const updated = pulseService.update(saved.id, { minute: 45 });
    gate.resolve(); await executing;
    expect(pulseService.getById(saved.id)?.nextRunAt).toEqual(updated?.nextRunAt);
    expect(pulseService.getById(saved.id)?.lastRunId).toBeTruthy();
  });

  it("rechecks each due Pulse after an earlier launch yields to a manual launch", async () => {
    const a = pulse(), b = pulse(), entered = deferred<void>(), gate = deferred<void>();
    pulseService.update(a.id, { prompt: "first" }); pulseService.update(b.id, { prompt: "second" });
    makePulsesDue();
    let held: string | undefined;
    vi.mocked(runsService.executeRun).mockImplementation(async (input) => {
      const runId = createRun(fixture.db, { providerId: "claude_code", mode: "work" }).id;
      if (!held) { held = input.goal; entered.resolve(); await gate.promise; }
      return { runId };
    });
    const ticking = pulseService.tick(); await entered.promise;
    await pulseService.runNow(held === "first" ? b.id : a.id); gate.resolve(); await ticking;
    expect(runsService.executeRun).toHaveBeenCalledTimes(2);
  });

  it.each(["pulse", "automation"])("drains an already accepted %s result before shutdown completes", async (kind) => {
    const entered = deferred<void>(), gate = deferred<void>();
    let executing: Promise<unknown>, stop: () => unknown;
    if (kind === "pulse") {
      vi.mocked(runsService.executeRun).mockImplementation(async () => {
        const runId = createRun(fixture.db, { providerId: "claude_code", mode: "work" }).id;
        entered.resolve(); await gate.promise; return { runId };
      });
      executing = pulseService.runNow(pulse().id); stop = () => pulseService.stop();
    } else {
      const saved = automation(async () => { entered.resolve(); await gate.promise; return '{"ok":true}'; });
      executing = automationsService.executeAutomation(saved.id); stop = () => automationsService.stop();
    }
    await entered.promise;
    let closed = false;
    const stopping = Promise.resolve(stop()).then(() => { closed = true; });
    try {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(closed).toBe(false);
    } finally { gate.resolve(); await executing; await stopping; }
  });

  it.each(["delete", "disable", "reschedule"])("retires pending Pulse preparation on %s", async (change) => {
    const saved = pulse(), entered = deferred<void>(), gate = deferred<void>(), getAll = spaceService.getAll.bind(spaceService);
    vi.spyOn(spaceService, "getAll").mockImplementationOnce(async () => {
      const spaces = await getAll(); entered.resolve(); await gate.promise; return spaces;
    });
    const preparing = pulseService.runNow(saved.id); await entered.promise;
    if (change === "delete") pulseService.delete(saved.id);
    else pulseService.update(saved.id, change === "disable" ? { isActive: false } : { minute: 45 });
    gate.resolve(); await preparing;
    expect(runsService.executeRun).not.toHaveBeenCalled();
    if (change === "reschedule") expect(pulseService.getById(saved.id)?.nextRunAt?.getMinutes()).toBe(45);
  });

  it("does not revive old Pulse preparation when the scheduler stops and starts again", async () => {
    const saved = pulse(), entered = deferred<void>(), gate = deferred<void>(), getAll = spaceService.getAll.bind(spaceService);
    vi.spyOn(spaceService, "getAll").mockImplementationOnce(async () => {
      const spaces = await getAll(); entered.resolve(); await gate.promise; return spaces;
    });
    const preparing = pulseService.runNow(saved.id); await entered.promise;
    const stopping = pulseService.stop(); pulseService.start(); gate.resolve(); await preparing; await stopping;
    expect(runsService.executeRun).not.toHaveBeenCalled();
    await pulseService.runNow(saved.id);
    expect(runsService.executeRun).toHaveBeenCalledOnce();
  });

  it.each(["pulse", "automation"])("retires an admitted %s launch before its first asynchronous preparation on stop", async (kind) => {
    const action = vi.fn(async () => '{"ok":true}');
    let executing: Promise<unknown>, stopping: unknown;
    if (kind === "pulse") {
      const saved = pulse(); executing = pulseService.runNow(saved.id); stopping = pulseService.stop();
    } else {
      const saved = automation(action); executing = automationsService.executeAutomation(saved.id); stopping = automationsService.stop();
    }
    await executing; await stopping;
    expect(runsService.executeRun).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
  });

  it.each(["pulse", "automation"])("does not let an accepted %s completion restart scheduling after stop", async (kind) => {
    const entered = deferred<void>(), gate = deferred<void>();
    const action = vi.fn(async () => { entered.resolve(); await gate.promise; return '{"ok":true}'; });
    let executing: Promise<unknown>, stop: () => unknown;
    if (kind === "pulse") {
      vi.mocked(runsService.executeRun).mockImplementation(async () => {
        const runId = createRun(fixture.db, { providerId: "claude_code", mode: "work" }).id;
        await action(); return { runId };
      });
      executing = pulseService.runNow(pulse().id); stop = () => pulseService.stop();
    } else {
      executing = automationsService.executeAutomation(automation(action).id); stop = () => automationsService.stop();
    }
    await entered.promise;
    const stopping = stop(); gate.resolve(); await executing; await stopping;
    await vi.advanceTimersByTimeAsync(kind === "pulse" ? 2 * 60 * 60_000 : 2 * 60_000);
    expect(action).toHaveBeenCalledOnce();
  });

  it("coalesces manual and timer automation launches into one execution receipt", async () => {
    const entered = deferred<void>(), gate = deferred<void>();
    const action = vi.fn(async () => { entered.resolve(); await gate.promise; return '{"ok":true}'; });
    const saved = automation(action);
    await vi.advanceTimersByTimeAsync(60_000); await entered.promise;
    const manual = automationsService.executeAutomation(saved.id); gate.resolve(); await manual;
    expect(action).toHaveBeenCalledOnce();
    expect(automationsService.getRunHistory(saved.id)).toHaveLength(1);
    expect(automationsService.getRunHistory(saved.id)[0].status).toBe("success");
  });

  it("coalesces concurrent manual Pulse launches into one accepted run", async () => {
    const saved = pulse(), entered = deferred<void>(), gate = deferred<void>();
    vi.mocked(runsService.executeRun).mockImplementation(async () => {
      const runId = createRun(fixture.db, { providerId: "claude_code", mode: "work" }).id;
      entered.resolve(); await gate.promise; return { runId };
    });
    const first = pulseService.runNow(saved.id); await entered.promise;
    const second = pulseService.runNow(saved.id); gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(runsService.executeRun).toHaveBeenCalledOnce();
    expect(a?.lastRunId).toBeTruthy(); expect(b?.lastRunId).toBe(a?.lastRunId);
  });
});
