import { EventEmitter } from "events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: null as unknown as import("events").EventEmitter & { quit: () => void },
  showMessageBox: vi.fn(),
}));

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("events");
  mocks.app = Object.assign(new Emitter(), { quit: vi.fn() });
  return { app: mocks.app, dialog: { showMessageBox: mocks.showMessageBox } };
});

import { attachCrashRecovery, createCrashLoopGuard, watchChildProcesses } from "./crash-recovery";

function fakeWindow() {
  const contents = Object.assign(new EventEmitter(), {
    reload: vi.fn(),
    forcefullyCrashRenderer: vi.fn(),
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
  });
  return { window, contents };
}

const gone = (reason: string) => [{}, { reason, exitCode: 1 }] as const;

/** Let a dialog's `.then` run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mocks.showMessageBox.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCrashLoopGuard", () => {
  it("allows reloads until the limit lands within the window", () => {
    const guard = createCrashLoopGuard(3, 60_000);
    expect(guard.record(0)).toBe(true);
    expect(guard.record(10_000)).toBe(true);
    expect(guard.record(20_000)).toBe(false);
  });

  it("forgets crashes older than the window, and on reset", () => {
    const guard = createCrashLoopGuard(3, 60_000);
    guard.record(0);
    guard.record(10_000);
    expect(guard.record(70_001)).toBe(true); // the first has aged out
    guard.reset();
    expect(guard.record(70_002)).toBe(true);
  });
});

describe("attachCrashRecovery", () => {
  it("reloads after a crash without asking", () => {
    const { window, contents } = fakeWindow();
    attachCrashRecovery(window as unknown as BrowserWindow);

    contents.emit("render-process-gone", ...gone("oom"));

    expect(contents.reload).toHaveBeenCalledTimes(1);
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });

  it("stops reloading on a crash loop and lets the user decide", async () => {
    const { window, contents } = fakeWindow();
    attachCrashRecovery(window as unknown as BrowserWindow);
    mocks.showMessageBox.mockResolvedValue({ response: 0 });

    contents.emit("render-process-gone", ...gone("crashed"));
    contents.emit("render-process-gone", ...gone("crashed"));
    contents.emit("render-process-gone", ...gone("crashed"));
    expect(contents.reload).toHaveBeenCalledTimes(2);
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(1);

    await flush();
    expect(contents.reload).toHaveBeenCalledTimes(3); // "Reload"
    // …and the count starts over, so the next crash reloads on its own again.
    contents.emit("render-process-gone", ...gone("crashed"));
    expect(contents.reload).toHaveBeenCalledTimes(4);
  });

  it("quits when the user gives up on a crash loop", async () => {
    const { window, contents } = fakeWindow();
    attachCrashRecovery(window as unknown as BrowserWindow, createCrashLoopGuard(1));
    mocks.showMessageBox.mockResolvedValue({ response: 1 });

    contents.emit("render-process-gone", ...gone("crashed"));
    await flush();

    expect(mocks.app.quit).toHaveBeenCalled();
    expect(contents.reload).not.toHaveBeenCalled();
  });

  it("ignores a clean exit", () => {
    const { window, contents } = fakeWindow();
    attachCrashRecovery(window as unknown as BrowserWindow);
    contents.emit("render-process-gone", ...gone("clean-exit"));
    expect(contents.reload).not.toHaveBeenCalled();
  });

  it("asks before reloading a hung window, and restarts its renderer on Reload", async () => {
    const { window, contents } = fakeWindow();
    attachCrashRecovery(window as unknown as BrowserWindow);
    mocks.showMessageBox.mockResolvedValue({ response: 1 });

    window.emit("unresponsive");
    window.emit("unresponsive"); // one prompt at a time
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(1);
    await flush();

    expect(contents.forcefullyCrashRenderer).toHaveBeenCalled();
    expect(contents.reload).toHaveBeenCalledTimes(1);
    // The exit we caused is not a crash: no second reload.
    contents.emit("render-process-gone", ...gone("killed"));
    expect(contents.reload).toHaveBeenCalledTimes(1);
  });

  it("takes the hang prompt down when the window recovers", async () => {
    const { window, contents } = fakeWindow();
    attachCrashRecovery(window as unknown as BrowserWindow);
    let signal: AbortSignal | undefined;
    mocks.showMessageBox.mockImplementation(
      (_window: unknown, options: { signal: AbortSignal }) => {
        signal = options.signal;
        // Aborting closes the box as its cancel button ("Wait").
        return new Promise((resolve) =>
          options.signal.addEventListener("abort", () => resolve({ response: 0 })),
        );
      },
    );

    window.emit("unresponsive");
    window.emit("responsive");
    await flush();

    expect(signal?.aborted).toBe(true);
    expect(contents.reload).not.toHaveBeenCalled();
    // A later hang gets a fresh prompt.
    window.emit("unresponsive");
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(2);
  });

  // Keep last: quitting is one-way for the module.
  it("does nothing once the app is quitting", () => {
    const { window, contents } = fakeWindow();
    attachCrashRecovery(window as unknown as BrowserWindow);
    mocks.app.emit("before-quit");

    contents.emit("render-process-gone", ...gone("killed"));
    window.emit("unresponsive");

    expect(contents.reload).not.toHaveBeenCalled();
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });
});

describe("watchChildProcesses", () => {
  it("logs a helper process that died, not one that exited cleanly", () => {
    watchChildProcesses();
    mocks.app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 9 });
    mocks.app.emit("child-process-gone", {}, { type: "Utility", reason: "clean-exit", exitCode: 0 });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[app] GPU process gone: crashed (exit code 9)");
  });
});
