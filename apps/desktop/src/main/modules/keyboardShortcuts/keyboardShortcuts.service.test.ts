import { afterEach, beforeEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("@mains/backend/modules/appSettings", () => ({ appSettingsService: { getSettings: storage.get, updateKeyboardShortcutOverrides: storage.save } }));
let service: typeof import("./keyboardShortcuts.service")["keyboardShortcutsService"];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }
beforeEach(async () => {
  vi.resetModules(); storage.get.mockReset().mockResolvedValue({ keyboardShortcutOverrides: "{}" }); storage.save.mockReset().mockResolvedValue(undefined);
  service = (await import("./keyboardShortcuts.service")).keyboardShortcutsService;
});
afterEach(() => vi.unstubAllGlobals());
it("preserves both admitted edits when the earlier persistence write is slow", async () => {
  const firstWrite = deferred<void>(); storage.save.mockReturnValueOnce(firstWrite.promise);
  const first = service.update({ id: "app.newItem", binding: null });
  await vi.waitFor(() => expect(storage.save).toHaveBeenCalledOnce());
  const second = service.update({ id: "app.openSettings", binding: null });
  firstWrite.resolve(); await Promise.all([first, second]);
  expect(service.getStatus().overrides).toEqual({ "app.newItem": null, "app.openSettings": null });
  expect(JSON.parse(storage.save.mock.calls.at(-1)![0])).toEqual({ "app.newItem": null, "app.openSettings": null });
});

it.each(["darwin", "linux", "win32"])("validates a queued edit against confirmed bindings on %s", async (platform) => {
  vi.stubGlobal("window", { api: { platform: { os: platform } } });
  const binding = platform === "darwin" ? "Command+N" : "Control+N";
  const firstWrite = deferred<void>(); storage.save.mockReturnValueOnce(firstWrite.promise);
  const unassign = service.update({ id: "app.newItem", binding: null });
  await vi.waitFor(() => expect(storage.save).toHaveBeenCalledOnce());
  const reassign = service.update({ id: "app.commandMenu", binding });
  firstWrite.resolve(); await Promise.all([unassign, reassign]);
  expect(service.getStatus().overrides).toEqual({ "app.newItem": null, "app.commandMenu": binding });
});
it("ignores startup reads after a manual edit or shutdown", async () => {
  const initial = deferred<{ keyboardShortcutOverrides: string }>(); storage.get.mockReturnValueOnce(initial.promise);
  const starting = service.start(); await service.update({ id: "app.newItem", binding: null });
  await service.stop(); initial.resolve({ keyboardShortcutOverrides: "{}" }); await starting;
  expect(service.getBinding("app.newItem")).toBeNull();
  await expect(service.resetAll()).rejects.toThrow(/stopping/);
});
it("orders reset after an accepted edit and recovers from an earlier failed write", async () => {
  storage.save.mockRejectedValueOnce(new Error("Disk unavailable"));
  await expect(service.update({ id: "app.newItem", binding: null })).rejects.toThrow("Disk unavailable");
  expect(service.getStatus().overrides).toEqual({});
  await Promise.all([service.update({ id: "app.newItem", binding: null }), service.resetAll()]);
  expect(service.getStatus().overrides).toEqual({}); expect(storage.save).toHaveBeenLastCalledWith("{}");
});
it("drains an accepted write but rejects queued writes after shutdown admission", async () => {
  const write = deferred<void>(); storage.save.mockReturnValueOnce(write.promise);
  const first = service.update({ id: "app.newItem", binding: null });
  await vi.waitFor(() => expect(storage.save).toHaveBeenCalledOnce());
  const next = service.resetAll().catch((error: unknown) => error);
  let stopped = false; const stopping = service.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve)); expect(stopped).toBe(false);
  write.resolve(); await first; await stopping;
  expect(await next).toBeInstanceOf(Error); expect(storage.save).toHaveBeenCalledOnce();
});
