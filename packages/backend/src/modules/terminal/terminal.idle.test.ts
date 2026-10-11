import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ idle: vi.fn(), spawn: vi.fn() }));
vi.mock("./terminal-servers", () => ({ scanIdleTerminalShells: mocks.idle, scanTerminalServers: vi.fn() }));
vi.mock("node-pty", () => ({ spawn: mocks.spawn }));
vi.mock("./terminal-shell", async (importOriginal) => {
  const original = await importOriginal<typeof import("./terminal-shell")>();
  return { ...original, workspaceShellEnvironment: (env: Record<string, string>) => ({ env, signals: original.terminalShellSignals("test") }) };
});
import { terminalService } from "./terminal.service";

const shells: { data: (data: string) => void; exit: (event: { exitCode: number }) => void; kill: ReturnType<typeof vi.fn> }[] = [];
const prompt = "\x1b]633;Mains;test;idle\x07";
const busy = "\x1b]633;Mains;test;busy\x07";
function create(id: string, workspaceId: string | null = "w", ready = true) {
  terminalService.create(id, os.tmpdir(), () => {}, { workspaceId: workspaceId ?? undefined });
  const shell = shells.at(-1)!;
  if (ready) shell.data(prompt);
  return shell;
}

beforeEach(() => {
  terminalService.destroyAll();
  shells.length = 0;
  mocks.idle.mockReset().mockImplementation(async (roots: Map<string, number>) => new Set(roots.keys()));
  mocks.spawn.mockReset().mockImplementation(() => {
    const shell = { data: (_data: string) => {}, exit: (_event: { exitCode: number }) => {}, kill: vi.fn() };
    shells.push(shell);
    return { pid: 100 + shells.length, write: vi.fn(), resize: vi.fn(), kill: shell.kill,
      onData: (callback: typeof shell.data) => { shell.data = callback; return { dispose() {} }; },
      onExit: (callback: typeof shell.exit) => { shell.exit = callback; return { dispose() {} }; } };
  });
});
afterEach(() => terminalService.destroyAll());

describe("idle terminal cleanup on panel hide", () => {
  it("closes only verified prompt shells in that workspace and preserves jobs, unknown startup and auth", async () => {
    const idleA = create("idle-a");
    const idleB = create("idle-b");
    const job = create("job"); job.data(busy);
    const background = create("background");
    const unknown = create("unknown", "w", false);
    const other = create("other", "other-workspace");
    const auth = create("auth", null);
    mocks.idle.mockResolvedValue(new Set(["idle-a", "idle-b"]));
    expect(await terminalService.destroyIdle("w")).toEqual(["idle-a", "idle-b"]);
    expect(idleA.kill).toHaveBeenCalledOnce();
    expect(idleB.kill).toHaveBeenCalledOnce();
    for (const shell of [job, background, unknown, other, auth]) expect(shell.kill).not.toHaveBeenCalled();
    expect(terminalService.list().map((entry) => entry.id)).toEqual(["job", "background", "unknown", "other"]);
    expect([...mocks.idle.mock.calls[0][0].keys()]).toEqual(["idle-a", "idle-b", "background"]);
  });

  it("does not close a just-submitted command before it has spawned a child", async () => {
    const shell = create("t");
    terminalService.write("t", "npm run dev\r");
    expect(await terminalService.destroyIdle("w")).toEqual([]);
    expect([...mocks.idle.mock.calls[0][0].keys()]).toEqual([]);
    expect(shell.kill).not.toHaveBeenCalled();
  });

  it.each(["input", "output", "reattach", "replace"])("preserves a terminal changed by %s while inspection is pending", async (change) => {
    const original = create("t");
    let finish!: (result: Set<string>) => void;
    mocks.idle.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const cleanup = terminalService.destroyIdle("w");
    if (change === "input") terminalService.write("t", "npm run dev\r");
    if (change === "output") original.data("new output");
    if (change === "reattach") terminalService.attach("t", () => {});
    if (change === "replace") { terminalService.destroy("t"); create("t"); }
    finish(new Set(["t"]));
    expect(await cleanup).toEqual([]);
    expect(shells.at(-1)!.kill).not.toHaveBeenCalled();
    expect(terminalService.list().map((entry) => entry.id)).toEqual(["t"]);
  });

  it("keeps a newly opened tab out of an older pending cleanup", async () => {
    create("old");
    let finish!: (result: Set<string>) => void;
    mocks.idle.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const cleanup = terminalService.destroyIdle("w");
    const created = create("new");
    finish(new Set(["old", "new"]));
    expect(await cleanup).toEqual(["old"]);
    expect(created.kill).not.toHaveBeenCalled();
  });

  it("retains live shells on inspection failure but removes already exited tabs", async () => {
    const live = create("live");
    const exited = create("exited"); exited.exit({ exitCode: 0 });
    mocks.idle.mockRejectedValue(new Error("ps unavailable"));
    expect(await terminalService.destroyIdle("w")).toEqual(["exited"]);
    expect(live.kill).not.toHaveBeenCalled();
    expect(exited.kill).not.toHaveBeenCalled();
    await expect(terminalService.destroyIdle("")).rejects.toThrow("Invalid terminal workspace");
  });
});
