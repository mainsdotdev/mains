import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  packaged: true, version: "0.22.0", ready: true,
  check: vi.fn(), install: vi.fn(), feed: vi.fn(),
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: Object.defineProperty(Object.assign(new EventEmitter(), { isReady: () => native.ready, getVersion: () => native.version }), "isPackaged", { get: () => native.packaged }),
    autoUpdater: Object.assign(new EventEmitter(), { checkForUpdates: native.check, quitAndInstall: native.install, setFeedURL: native.feed }),
  };
});

let service: typeof import("./updates.service")["updatesService"];
let updater: EventEmitter;
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  native.packaged = true; native.version = "0.22.0"; native.ready = true;
  native.check.mockReset(); native.install.mockReset(); native.feed.mockReset();
  const electron = await import("electron"); updater = electron.autoUpdater;
  updater.removeAllListeners(); electron.app.removeAllListeners();
  native.check.mockImplementation(() => { updater.emit("checking-for-update"); });
  service = (await import("./updates.service")).updatesService;
});
afterEach(() => {
  service.shutdown();
  updater.removeAllListeners(); vi.clearAllTimers(); vi.useRealTimers();
  Object.defineProperty(process, "platform", platform); vi.restoreAllMocks();
});

describe("updatesService ownership", () => {
  it("joins manual checks while the startup check is still pending", async () => {
    service.initialize(); native.check.mockClear();
    await Promise.all([service.checkForUpdates(), service.checkForUpdates()]);
    expect(native.check).not.toHaveBeenCalled();
    expect(service.getStatus().status).toBe("checking");
  });
  it("keeps a confirmed download ready across delayed check events and errors", async () => {
    service.initialize(); updater.emit("update-available");
    updater.emit("update-downloaded", {}, "Notes", "0.23.0");
    for (const event of ["checking-for-update", "update-available", "update-not-available"]) {
      updater.emit(event);
      expect(service.getStatus()).toMatchObject({ status: "downloaded", info: { version: "0.23.0" } });
    }
    updater.emit("error", new Error("Background check failed"));
    expect(service.getStatus()).toMatchObject({ status: "downloaded", info: { version: "0.23.0" }, error: "Background check failed" });
    native.check.mockClear(); await service.checkForUpdates();
    expect(native.check).not.toHaveBeenCalled();
  });

  it("requires a confirmed download and claims installation before native reentry", () => {
    service.initialize();
    expect(() => service.quitAndInstall()).toThrow(/download/i);
    expect(native.install).not.toHaveBeenCalled();
    updater.emit("update-available"); updater.emit("update-downloaded", {}, "Notes", "0.23.0");
    native.install.mockImplementationOnce(() => { service.quitAndInstall(); });
    service.quitAndInstall(); service.quitAndInstall();
    expect(native.install).toHaveBeenCalledOnce();
  });

  it("shares admission between scheduled checks and explicit controls", async () => {
    service.initialize();
    await vi.advanceTimersByTimeAsync(3600000);
    expect(native.check).toHaveBeenCalledOnce();
    updater.emit("update-not-available");
    await vi.advanceTimersByTimeAsync(3600000);
    expect(native.check).toHaveBeenCalledTimes(2);
    updater.emit("update-available");
    await vi.advanceTimersByTimeAsync(3600000);
    expect(native.check).toHaveBeenCalledTimes(2);
    updater.emit("update-downloaded", {}, "", "0.23.0");
    await vi.advanceTimersByTimeAsync(3600000);
    expect(native.check).toHaveBeenCalledTimes(2);
  });

  it("retires queued callbacks and the timer when update IPC is unregistered", async () => {
    service.initialize();
    const old = updater.listeners("update-downloaded")[0];
    const snapshot = service.getStatus();
    const foreign = vi.fn(); updater.on("update-available", foreign);
    const { unregisterUpdatesIpc } = await import("./updates.ipc");
    unregisterUpdatesIpc();
    await vi.advanceTimersByTimeAsync(3 * 3600000);
    expect(native.check).toHaveBeenCalledOnce();
    old({}, "", "late-version");
    updater.emit("update-available");
    expect(service.getStatus()).toEqual(snapshot);
    expect(foreign).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(updater.listenerCount("checking-for-update")).toBe(0);
    expect(() => updater.emit("error", new Error("Late native failure"))).not.toThrow();
    service.initialize(); await service.checkForUpdates();
    expect(native.check).toHaveBeenCalledOnce();
  });

  it("ignores late download events after a no-update terminal receipt", () => {
    service.initialize(); updater.emit("update-not-available");
    updater.emit("update-available"); updater.emit("update-downloaded", {}, "", "obsolete-version");
    expect(service.getStatus()).toMatchObject({ status: "not-available", info: null });
  });

  it("allows explicit installation retry after an asynchronous native error", () => {
    service.initialize(); updater.emit("update-available"); updater.emit("update-downloaded", {}, "", "0.23.0");
    service.quitAndInstall(); updater.emit("error", new Error("Restart failed"));
    expect(service.getStatus()).toMatchObject({ status: "downloaded", error: "Restart failed" });
    service.quitAndInstall(); expect(native.install).toHaveBeenCalledTimes(2);
  });

  it("retires a failed feed binding before an explicit initialization retry", () => {
    let obsolete!: (...args: any[]) => void;
    native.feed.mockImplementationOnce(() => { obsolete = updater.listeners("update-downloaded")[0] as (...args: any[]) => void; throw new Error("Feed unavailable"); });
    service.initialize();
    expect(service.getStatus()).toMatchObject({ status: "error", error: "Feed unavailable" });
    expect(native.check).not.toHaveBeenCalled();
    service.initialize();
    obsolete({}, "", "obsolete-version");
    expect(service.getStatus()).toMatchObject({ status: "checking", info: null });
    expect(updater.listenerCount("update-downloaded")).toBe(1);
    expect(native.check).toHaveBeenCalledOnce();
  });

  it("starts with an idle public snapshot", () => {
    expect(service.getStatus()).toEqual({ status: "idle", info: null, progress: null, error: null });
  });
  it("returns independent copies of confirmed update metadata", () => {
    service.initialize(); updater.emit("update-downloaded", {}, "", "0.23.0");
    const copy = service.getStatus(); copy.status = "error"; copy.info!.version = "changed";
    expect(service.getStatus()).toMatchObject({ status: "downloaded", info: { version: "0.23.0" } });
  });
  it("configures one feed before checking and initializes one listener/timer set", async () => {
    service.initialize(); service.initialize();
    expect(native.feed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: `https://update.electronjs.org/mainsdotdev/mains/darwin-${process.arch}/0.22.0` }));
    expect(native.feed.mock.invocationCallOrder[0]).toBeLessThan(native.check.mock.invocationCallOrder[0]);
    expect(updater.listenerCount("update-downloaded")).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(await service.downloadUpdate()).toEqual(service.getStatus());
    expect(native.check).toHaveBeenCalledOnce();
  });
  it.each([
    [false, "darwin", "0.22.0"], [true, "win32", "0.22.0"],
    [true, "linux", "0.22.0"], [true, "darwin", "0.23.0-beta.1"],
  ] as const)("keeps manual upgrade policy for packaged=%s platform=%s version=%s", async (packaged, os, version) => {
    native.packaged = packaged; native.version = version;
    Object.defineProperty(process, "platform", { ...platform, value: os });
    service.initialize();
    expect((await service.checkForUpdates()).status).toBe("not-available");
    expect(await service.downloadUpdate()).toEqual(service.getStatus());
    expect(() => service.quitAndInstall()).toThrow(packaged ? /latest release/ : /development mode/);
    expect(native.feed).not.toHaveBeenCalled(); expect(native.check).not.toHaveBeenCalled(); expect(native.install).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("defers initialization until app readiness and joins controls in that interval", async () => {
    native.ready = false; service.initialize(); service.initialize(); await service.checkForUpdates();
    const { app } = await import("electron");
    expect(app.listenerCount("ready")).toBe(1); expect(native.feed).not.toHaveBeenCalled();
    native.ready = true; app.emit("ready");
    expect(native.feed).toHaveBeenCalledOnce(); expect(native.check).toHaveBeenCalledOnce();
    expect(app.listenerCount("ready")).toBe(0);
  });
  it("retires a queued ready callback when shutdown precedes app readiness", async () => {
    native.ready = false; service.initialize();
    const { app } = await import("electron"); const queued = app.listeners("ready")[0];
    service.shutdown(); queued(); native.ready = true; app.emit("ready");
    expect(native.feed).not.toHaveBeenCalled(); expect(native.check).not.toHaveBeenCalled();
    expect(app.listenerCount("ready")).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("initializes through the first explicit check without dispatching it twice", async () => {
    await service.checkForUpdates();
    expect(native.feed).toHaveBeenCalledOnce(); expect(native.check).toHaveBeenCalledOnce();
  });
  it("returns synchronous native check failures as state and permits retry", async () => {
    native.check.mockImplementationOnce(() => { throw new Error("Network unavailable"); });
    service.initialize();
    expect(service.getStatus()).toMatchObject({ status: "error", error: "Network unavailable" });
    expect((await service.checkForUpdates()).status).toBe("checking"); expect(native.check).toHaveBeenCalledTimes(2);
  });
  it("permits a new check after an asynchronous failure and retires late completion", async () => {
    service.initialize(); updater.emit("error", new Error("Network unavailable"));
    updater.emit("update-downloaded", {}, "", "obsolete-version");
    expect(service.getStatus()).toMatchObject({ status: "error", info: null });
    await service.checkForUpdates(); expect(service.getStatus().status).toBe("checking");
  });
  it("retains the downloaded package and releases a synchronous failed install for retry", () => {
    service.initialize(); updater.emit("update-downloaded", {}, "", "0.23.0");
    native.install.mockImplementationOnce(() => { throw new Error("Restart blocked"); });
    expect(() => service.quitAndInstall()).toThrow("Restart blocked");
    expect(service.getStatus()).toMatchObject({ status: "downloaded", info: { version: "0.23.0" }, error: "Restart blocked" });
    service.quitAndInstall(); expect(native.install).toHaveBeenCalledTimes(2);
  });
  it.each(["event", "throw"])("keeps a busy native refusal nonterminal: %s", async (delivery) => {
    if (delivery === "throw") native.check.mockImplementationOnce(() => { throw new Error("command is disabled"); });
    service.initialize();
    if (delivery === "event") updater.emit("error", new Error("command is disabled"));
    await service.checkForUpdates();
    expect(service.getStatus()).toMatchObject({ status: "checking", error: null });
    expect(native.check).toHaveBeenCalledOnce();
    updater.emit("update-downloaded", {}, "", "0.23.0"); expect(service.getStatus().status).toBe("downloaded");
  });
  it("broadcasts each admitted phase once and releases its error drain at process exit", async () => {
    const { registerEventSink } = await import("@mains/backend/ipc-kit");
    const send = vi.fn(), off = registerEventSink({ kind: "fixture", send });
    try {
      service.initialize(); updater.emit("update-available"); updater.emit("update-available");
      updater.emit("update-downloaded", {}, "", "0.23.0"); updater.emit("update-downloaded", {}, "", "other-version");
      expect(send.mock.calls.map(([, state]) => state.status)).toEqual(["checking", "available", "downloaded"]);
      service.shutdown();
      expect(updater.listenerCount("error")).toBe(1);
      (await import("electron")).app.emit("will-quit");
      expect(updater.listenerCount("error")).toBe(0);
      expect(() => service.quitAndInstall()).toThrow(/shut down/);
    } finally { off(); }
  });

  it("does not acquire a native check or timer after reentrant shutdown during publication", async () => {
    const { registerEventSink } = await import("@mains/backend/ipc-kit");
    const off = registerEventSink({ kind: "fixture", send: () => service.shutdown() });
    try {
      service.initialize();
      expect(native.check).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { off(); }
  });

});
