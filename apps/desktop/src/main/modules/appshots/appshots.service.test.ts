import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_APPSHOT_SHORTCUT } from "../../../shared/appshots";

const native = vi.hoisted(() => ({
  directory: "", sources: vi.fn(), script: vi.fn(), register: vi.fn(), unregister: vi.fn(),
  settings: vi.fn(), save: vi.fn(), send: vi.fn(), show: vi.fn(), focus: vi.fn(), create: vi.fn(),
  screen: "granted", trusted: false,
}));
vi.mock("electron", () => ({
  app: { getPath: () => native.directory }, desktopCapturer: { getSources: native.sources },
  globalShortcut: { register: native.register, unregister: native.unregister }, shell: { openExternal: vi.fn() },
  systemPreferences: { getMediaAccessStatus: () => native.screen, isTrustedAccessibilityClient: () => native.trusted },
}));
vi.mock("node:child_process", () => ({ execFile: Object.assign(vi.fn(), { [Symbol.for("nodejs.util.promisify.custom")]: native.script }) }));
vi.mock("@mains/backend/modules/appSettings", () => ({ appSettingsService: { getSettings: native.settings, updateAppshotsSettings: native.save } }));
vi.mock("../../windows", () => ({ createMainWindow: native.create, getMainWindow: () => ({
  isDestroyed: () => false, isMinimized: () => false, webContents: { send: native.send }, show: native.show, focus: native.focus,
}) }));
let service: typeof import("./appshots.service")["appshotsService"];
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const source = { id: "window:99:0", name: "Docs", thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from("png") } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }
beforeEach(async () => {
  vi.resetModules(); Object.defineProperty(process, "platform", { value: "darwin" });
  native.directory = mkdtempSync(join(tmpdir(), "mains-lens-test-"));
  native.sources.mockReset().mockResolvedValue([source]);
  native.script.mockReset().mockResolvedValue({ stdout: JSON.stringify({ appName: "Safari", processId: 42, windowId: 99, windowTitle: "Docs" }) });
  native.settings.mockReset().mockResolvedValue({ appshotsEnabled: true, appshotsShortcut: DEFAULT_APPSHOT_SHORTCUT });
  native.save.mockReset().mockResolvedValue(undefined); native.register.mockReset().mockReturnValue(true); native.unregister.mockReset();
  native.send.mockClear(); native.show.mockClear(); native.focus.mockClear(); native.create.mockClear();
  native.screen = "granted"; native.trusted = false;
  service = (await import("./appshots.service")).appshotsService;
});
afterEach(async () => { await service.stop(); Object.defineProperty(process, "platform", platform); rmSync(native.directory, { recursive: true, force: true }); vi.restoreAllMocks(); });

it("retires an in-flight capture before stop can publish or reopen the window", async () => {
  const pending = deferred<typeof source[]>(); native.sources.mockReturnValueOnce(pending.promise);
  const capture = service.captureAndDeliver().catch((error: unknown) => error);
  await vi.waitFor(() => expect(native.sources).toHaveBeenCalledOnce());
  const stopping = service.stop();
  pending.resolve([source]);
  expect(await capture).toBeInstanceOf(Error);
  await stopping;
  expect(native.send).not.toHaveBeenCalled(); expect(native.show).not.toHaveBeenCalled(); expect(native.create).not.toHaveBeenCalled();
  expect(readdirSync(native.directory, { recursive: true })).toEqual([]);
});

it("serializes native registration and preference writes through a failed earlier configuration", async () => {
  let fail!: (error: Error) => void;
  native.save.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  const first = service.configure({ enabled: true, shortcut: "Command+Shift+A" }).catch((error: unknown) => error);
  await vi.waitFor(() => expect(native.save).toHaveBeenCalledOnce());
  const second = service.configure({ enabled: true, shortcut: "Command+Option+Space" });
  fail(new Error("Storage unavailable"));
  await Promise.all([first, second]);
  expect(service.getStatus()).toMatchObject({ enabled: true, shortcut: "Command+Option+Space", shortcutRegistered: true });
  expect(native.save.mock.calls.at(-1)).toEqual([{ appshotsEnabled: true, appshotsShortcut: "Command+Option+Space" }]);
});

it.each(["disable", "stop"])("does not restore a late startup registration after %s", async (retirement) => {
  const settings = deferred<{ appshotsEnabled: boolean; appshotsShortcut: string }>();
  native.settings.mockReturnValueOnce(settings.promise);
  const starting = service.start();
  if (retirement === "stop") await service.stop();
  else await service.configure({ enabled: false, shortcut: DEFAULT_APPSHOT_SHORTCUT });
  settings.resolve({ appshotsEnabled: true, appshotsShortcut: "Command+Shift+A" });
  await starting;
  expect(native.register).not.toHaveBeenCalled();
  expect(service.getStatus().shortcutRegistered).toBe(false);
});

it("retains a delivered capture until its matching acknowledgement instead of losing it on a stale read", async () => {
  const capture = await service.captureAndDeliver();
  expect(service.consumePending().map((item) => item.id)).toEqual([capture.id]);
  expect(service.consumePending().map((item) => item.id)).toEqual([capture.id]);
  service.acknowledge("another-capture");
  expect(service.consumePending().map((item) => item.id)).toEqual([capture.id]);
  service.acknowledge(capture.id);
  expect(service.consumePending()).toEqual([]);
});

it("retires queued native shortcut callbacks through disable and re-enable of the same binding", async () => {
  await service.start();
  const obsolete = native.register.mock.calls[0][1] as () => void;
  await service.configure({ enabled: false, shortcut: DEFAULT_APPSHOT_SHORTCUT });
  await service.configure({ enabled: true, shortcut: DEFAULT_APPSHOT_SHORTCUT });
  obsolete();
  await new Promise((resolve) => setImmediate(resolve));
  expect(native.script).not.toHaveBeenCalled();
  expect(native.sources).not.toHaveBeenCalled();
});

it("drains the retired capture even when unregistering its shortcut fails, then retries release", async () => {
  await service.start();
  const pending = deferred<typeof source[]>(); native.sources.mockReturnValueOnce(pending.promise);
  const capture = service.captureAndDeliver().catch((error: unknown) => error);
  await vi.waitFor(() => expect(native.sources).toHaveBeenCalledOnce());
  native.unregister.mockImplementationOnce(() => { throw new Error("Shortcut release failed"); });
  let settled = false;
  const stopping = service.stop().catch((error: unknown) => error).finally(() => { settled = true; });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally { pending.resolve([source]); await capture; await stopping; }
  expect(await stopping).toBeInstanceOf(Error);
  expect(service.getStatus().shortcutRegistered).toBe(true);
  await service.stop();
  expect(service.getStatus().shortcutRegistered).toBe(false);
  expect(native.send).not.toHaveBeenCalled();
});

it.each(["denied", "restricted"])("does not read screen or accessibility content when permission is %s", async (permission) => {
  native.screen = permission;
  await expect(service.capture()).rejects.toThrow("Screen Recording permission");
  expect(native.script).not.toHaveBeenCalled(); expect(native.sources).not.toHaveBeenCalled();
});

it("admits one capture and releases failed acquisition for an explicit retry", async () => {
  const first = deferred<typeof source[]>(); native.sources.mockReturnValueOnce(first.promise);
  const capturing = service.capture().catch((error: unknown) => error);
  await vi.waitFor(() => expect(native.sources).toHaveBeenCalledOnce());
  await expect(service.capture()).rejects.toThrow("already in progress");
  first.resolve([]); expect(await capturing).toBeInstanceOf(Error);
  expect(service.getStatus().capturing).toBe(false);
  await expect(service.capture()).resolves.toMatchObject({ appName: "Safari" });
});

it("removes its provisional PNG when shutdown retires accessibility extraction", async () => {
  native.trusted = true;
  const text = deferred<{ stdout: string }>();
  native.script.mockResolvedValueOnce({ stdout: JSON.stringify({ appName: "Safari", processId: 42, windowId: 99 }) }).mockReturnValueOnce(text.promise);
  const capturing = service.captureAndDeliver().catch((error: unknown) => error);
  await vi.waitFor(() => expect(native.script).toHaveBeenCalledTimes(2));
  expect(readdirSync(join(native.directory, "browser-captures"))).toHaveLength(1);
  const stopping = service.stop();
  text.resolve({ stdout: JSON.stringify({ text: "Old text", truncated: false }) });
  expect(await capturing).toBeInstanceOf(Error); await stopping;
  expect(readdirSync(join(native.directory, "browser-captures"))).toEqual([]);
  expect(native.send).not.toHaveBeenCalled();
});

it("restores the previous registration when acquiring a new shortcut fails", async () => {
  await service.start(); native.register.mockReturnValueOnce(false);
  await expect(service.configure({ enabled: true, shortcut: "Command+Shift+A" })).rejects.toThrow(/shortcut/);
  expect(service.getStatus()).toMatchObject({ enabled: true, shortcut: DEFAULT_APPSHOT_SHORTCUT, shortcutRegistered: true });
  expect(native.register.mock.calls.at(-1)![0]).toBe(DEFAULT_APPSHOT_SHORTCUT);
  expect(native.save).not.toHaveBeenCalled();
});

it("does not restore registration after an in-flight preference write fails during stop", async () => {
  let fail!: (error: Error) => void;
  native.save.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  const configuring = service.configure({ enabled: true, shortcut: "Command+Shift+A" }).catch((error: unknown) => error);
  await vi.waitFor(() => expect(native.save).toHaveBeenCalledOnce());
  const stopping = service.stop(); fail(new Error("Write failed")); await Promise.all([configuring, stopping]);
  expect(native.register).toHaveBeenCalledOnce(); expect(service.getStatus().shortcutRegistered).toBe(false);
  await expect(service.configure({ enabled: true, shortcut: DEFAULT_APPSHOT_SHORTCUT })).rejects.toThrow(/stopping/);
});

it("bounds pending delivery and explicit deletion removes only its own queued PNG", async () => {
  const captures = [];
  for (let i = 0; i < 9; i++) captures.push(await service.captureAndDeliver());
  expect(service.consumePending().map((item) => item.id)).toEqual(captures.slice(1).map((item) => item.id));
  service.deleteCapture(captures[1].screenshotCaptureName);
  expect(service.consumePending().map((item) => item.id)).toEqual(captures.slice(2).map((item) => item.id));
  expect(readdirSync(join(native.directory, "browser-captures"))).not.toContain(captures[1].screenshotCaptureName);
  expect(() => service.deleteCapture("../../outside.png")).toThrow("Path escape");
});

it("keeps unsupported platforms free of registration and capture effects", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  expect(await service.start()).toMatchObject({ supported: false, shortcutRegistered: false });
  await expect(service.capture()).rejects.toThrow("macOS only");
  await expect(service.configure({ enabled: true, shortcut: DEFAULT_APPSHOT_SHORTCUT })).rejects.toThrow("macOS only");
  expect(native.register).not.toHaveBeenCalled(); expect(native.script).not.toHaveBeenCalled();
});
it("keeps an explicit test capture available while the global shortcut is disabled", async () => {
  await service.configure({ enabled: false, shortcut: DEFAULT_APPSHOT_SHORTCUT });
  await expect(service.captureAndDeliver()).resolves.toMatchObject({ appName: "Safari" });
  expect(native.register).not.toHaveBeenCalled(); expect(service.consumePending()).toHaveLength(1);
});
it("retains a completed capture for catch-up when the renderer notification fails", async () => {
  native.send.mockImplementationOnce(() => { throw new Error("Renderer unavailable"); });
  await expect(service.captureAndDeliver()).rejects.toThrow("Renderer unavailable");
  expect(service.consumePending()).toHaveLength(1);
  expect(readdirSync(join(native.directory, "browser-captures"))).toHaveLength(1);
});

it("ignores a retired startup read failure after a manual configuration succeeds", async () => {
  let fail!: (error: Error) => void;
  native.settings.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  const starting = service.start().catch((error: unknown) => error);
  await service.configure({ enabled: false, shortcut: DEFAULT_APPSHOT_SHORTCUT });
  fail(new Error("Obsolete startup failure"));
  expect(await starting).toMatchObject({ enabled: false, shortcutRegistered: false });
});
