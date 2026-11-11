import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_CLONE_CANCELED } from "@mains/contracts/workspace-intake";
const native = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn() }));
vi.mock("../../runtime/native-process", () => ({ spawnNativeProcess: native.spawn, killNativeProcess: native.kill }));
import { runCloneProcess } from "./clone-process";
let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  native.spawn.mockReturnValue(child);
});
afterEach(() => { child.stdout.destroy(); child.stderr.destroy(); vi.useRealTimers(); });
describe("clone native close ownership", () => {
  it("escalates cancellation but retains ownership until actual close", async () => {
    const cancellation = new AbortController();
    const pending = runCloneProcess("https://example.test/repo.git", "/private", cancellation.signal);
    let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
    cancellation.abort();
    expect(native.kill).toHaveBeenCalledWith(child, "SIGTERM");
    await vi.advanceTimersByTimeAsync(2000);
    expect(native.kill).toHaveBeenCalledWith(child, "SIGKILL");
    expect(settled).toBe(false);
    child.emit("close", null);
    await expect(pending).rejects.toThrow(WORKSPACE_CLONE_CANCELED);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fences late process/stream errors and aborts after successful close", async () => {
    const cancellation = new AbortController();
    const pending = runCloneProcess("https://example.test/repo.git", "/private", cancellation.signal);
    child.emit("close", 0); await pending;
    child.emit("error", new Error("Old process error")); child.emit("error", new Error("Another old error"));
    child.stderr.emit("error", new Error("Old stream error")); cancellation.abort();
    await vi.advanceTimersByTimeAsync(3000);
    expect(native.kill).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not spawn when cancellation already owns the request", async () => {
    const cancellation = new AbortController(); cancellation.abort();
    await expect(runCloneProcess("https://example.test/repo.git", "/private", cancellation.signal)).rejects.toThrow(WORKSPACE_CLONE_CANCELED);
    expect(native.spawn).not.toHaveBeenCalled();
  });
  it("joins native close after a spawn/stream error instead of releasing the directory early", async () => {
    const pending = runCloneProcess("https://example.test/repo.git", "/private");
    let settled = false; void pending.catch(() => { settled = true; });
    child.emit("error", new Error("Spawn failed")); await Promise.resolve();
    expect(settled).toBe(false); child.emit("close", -1);
    await expect(pending).rejects.toThrow("Spawn failed"); expect(vi.getTimerCount()).toBe(0);
  });
});
