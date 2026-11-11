import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WsHost } from "@mains/backend/ipc-kit/ws-server-host";

const native = vi.hoisted(() => ({
  startHost: vi.fn(), token: 0, power: undefined as unknown as EventEmitter,
  onBattery: false, blocker: 0, blockers: new Set<number>(),
  startBlocker: vi.fn(), stopBlocker: vi.fn(),
  settings: vi.fn(), persist: vi.fn(),
  startServe: vi.fn(), stopServe: vi.fn(), readStatus: vi.fn(),
}));
vi.mock("electron", () => ({
  powerMonitor: Object.assign(new EventEmitter(), { isOnBatteryPower: () => native.onBattery }),
  powerSaveBlocker: {
    start: native.startBlocker, stop: native.stopBlocker,
    isStarted: (id: number) => native.blockers.has(id),
  },
}));
vi.mock("node:os", () => ({ networkInterfaces: () => ({ eth0: [{ family: "IPv4", internal: false, address: "192.168.1.9" }] }) }));
vi.mock("@mains/backend/ipc-kit", () => ({ emit: vi.fn() }));
vi.mock("@mains/backend/ipc-kit/ws-server-host", () => ({ startWsHost: native.startHost }));
vi.mock("@mains/backend/ipc-kit/ws-auth", () => ({ generateToken: () => `session-${++native.token}` }));
vi.mock("@mains/backend/web-root", () => ({ resolveWebRoot: () => null }));
vi.mock("@mains/backend/modules/imageProxy", () => ({ imageProxyService: {}, serveLocalImage: vi.fn(), serveLocalDocument: vi.fn() }));
vi.mock("@mains/backend/modules/tailscale", () => ({ tailscaleService: {
  startServe: native.startServe, stopServe: native.stopServe, readStatus: native.readStatus,
  resolveHttpsUrl: (name: string, port: number) => `https://${name}${port === 443 ? "" : `:${port}`}`,
} }));
vi.mock("@mains/backend/modules/appSettings", () => ({ appSettingsService: { getSettings: native.settings, updateBackendAccess: native.persist } }));
vi.mock("@mains/backend/modules/backend", () => ({ backendService: { commandReceipts: {} }, clearPairingCodes: vi.fn() }));

let service: typeof import("./localBackend.service")["localBackendService"];
const hosts: ReturnType<typeof makeHost>[] = [];
function makeHost(port: number) {
  return { port, close: vi.fn().mockResolvedValue(undefined), connectedDeviceIds: () => new Set<string>(),
    createWebLogin: vi.fn((origin: string) => ({ url: `${origin}/#login=test-code`, expiresAt: 1 })), disconnectDevice: vi.fn() };
}
function host(port = 8787) {
  const value = makeHost(port);
  hosts.push(value); return value;
}
beforeEach(async () => {
  vi.resetModules();
  native.token = 0; native.onBattery = false; native.blockers.clear();
  native.startHost.mockReset().mockImplementation(async ({ port }) => host(port) as unknown as WsHost);
  native.settings.mockReset().mockResolvedValue(null); native.persist.mockReset().mockResolvedValue(undefined);
  native.startServe.mockReset().mockResolvedValue(undefined); native.stopServe.mockReset().mockResolvedValue(undefined);
  native.readStatus.mockReset().mockResolvedValue({ magicDnsName: "desktop.test.ts.net" });
  native.startBlocker.mockReset().mockImplementation(() => { const id = ++native.blocker; native.blockers.add(id); return id; });
  native.stopBlocker.mockReset().mockImplementation((id: number) => { native.blockers.delete(id); });
  native.power = (await import("electron")).powerMonitor as unknown as EventEmitter;
  native.power.removeAllListeners();
  service = (await import("./localBackend.service")).localBackendService;
});
afterEach(async () => {
  for (const value of hosts.splice(0)) value.close.mockReset().mockResolvedValue(undefined);
  native.stopServe.mockReset().mockResolvedValue(undefined);
  await service.shutdown().catch(() => {});
  native.power.removeAllListeners(); vi.restoreAllMocks();
});

it("drains a pending host acquisition before completing a later disable", async () => {
  let finish!: (value: WsHost) => void;
  native.startHost.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const value = host();
  const opening = service.setRemoteAccess(true);
  await vi.waitFor(() => expect(native.startHost).toHaveBeenCalledOnce());
  const disabling = service.setRemoteAccess(false);
  finish(value as unknown as WsHost);
  await Promise.all([opening, disabling]);
  expect(service.getStatus()).toMatchObject({ remoteAccess: false, bindHost: null, token: null, addresses: [] });
  expect(value.close).toHaveBeenCalledOnce();
});

it("retires a pending acquisition before shutdown and refuses later reactivation", async () => {
  let finish!: (value: WsHost) => void;
  native.startHost.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const value = host();
  const opening = service.setRemoteAccess(true).catch(() => undefined);
  await vi.waitFor(() => expect(native.startHost).toHaveBeenCalledOnce());
  const stopping = service.shutdown();
  finish(value as unknown as WsHost);
  await Promise.all([opening, stopping]);
  expect(service.getStatus()).toMatchObject({ remoteAccess: false, bindHost: null, token: null });
  expect(value.close).toHaveBeenCalledOnce();
  await expect(service.setRemoteAccess(true)).rejects.toThrow(/shut|closed/i);
});

it("retains a failed Tailscale release until retry instead of closing its target host", async () => {
  await service.setTailscaleHttps(true);
  native.stopServe.mockRejectedValueOnce(new Error("Serve stop failed"));
  await expect(service.setTailscaleHttps(false)).rejects.toThrow("Serve stop failed");
  expect(hosts[0].close).not.toHaveBeenCalled();
  await service.setTailscaleHttps(false);
  expect(native.stopServe).toHaveBeenCalledTimes(2);
  expect(hosts[0].close).toHaveBeenCalledOnce();
  expect(service.getStatus()).toMatchObject({ tailscale: false, bindHost: null });
});

it("does not acquire a sleep blocker from a preference while the host is still opening", async () => {
  await service.setKeepAwakeForRemoteAccess(true);
  let finish!: (value: WsHost) => void;
  native.startHost.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const value = host();
  const opening = service.setRemoteAccess(true);
  await vi.waitFor(() => expect(native.startHost).toHaveBeenCalledOnce());
  try {
    native.power.emit("on-ac");
    expect(native.startBlocker).not.toHaveBeenCalled();
  } finally { finish(value as unknown as WsHost); await opening; }
  expect(native.startBlocker).toHaveBeenCalledOnce();
});

it.each(["manual disable", "shutdown"])("ignores a late startup preference read after %s", async (retirement) => {
  let finish!: (value: unknown) => void;
  native.settings.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const restoring = service.restore();
  if (retirement === "shutdown") await service.shutdown();
  else await service.setRemoteAccess(false);
  finish({ backendRemoteAccess: true, backendLanAccess: true, backendTailscaleHttps: true, keepAwakeForRemoteAccess: true });
  await restoring;
  expect(native.startHost).not.toHaveBeenCalled();
  expect(native.startServe).not.toHaveBeenCalled();
  expect(native.startBlocker).not.toHaveBeenCalled();
  expect(service.getStatus()).toMatchObject({ remoteAccess: false, tailscale: false, bindHost: null });
});

it("persists exposure preferences in command order despite a slow earlier write", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let saved: Record<string, unknown> = {};
  native.persist.mockImplementationOnce(async (patch) => { await gate; saved = patch; })
    .mockImplementation(async (patch) => { saved = patch; });
  const opening = service.setRemoteAccess(true);
  await vi.waitFor(() => expect(native.persist).toHaveBeenCalledOnce());
  const lan = service.setLanAccess(true);
  await new Promise((resolve) => setImmediate(resolve));
  release(); await Promise.all([opening, lan]);
  expect(saved).toMatchObject({ backendRemoteAccess: true, backendLanAccess: true });
});

it("rolls back a failed initial host start and permits a clean explicit retry", async () => {
  native.startHost.mockRejectedValueOnce(new Error("Port unavailable"));
  await expect(service.setRemoteAccess(true)).rejects.toThrow("Port unavailable");
  expect(service.getStatus()).toMatchObject({ remoteAccess: false, bindHost: null, token: null, addresses: [] });
  expect(native.persist).not.toHaveBeenCalled();
  await service.setRemoteAccess(true);
  expect(service.getStatus()).toMatchObject({ remoteAccess: true, bindHost: "127.0.0.1" });
});

it("retains a failed host close for retry and refuses new browser grants during cleanup", async () => {
  await service.setRemoteAccess(true);
  hosts[0].close.mockRejectedValueOnce(new Error("Host close failed"));
  await expect(service.setRemoteAccess(false)).rejects.toThrow("Host close failed");
  expect(service.getStatus()).toMatchObject({ bindHost: "127.0.0.1", token: null, addresses: [] });
  expect(() => service.createWebLogin("http://127.0.0.1:8787")).toThrow(/Turn on remote access/);
  await service.setRemoteAccess(false);
  expect(hosts[0].close).toHaveBeenCalledTimes(2);
  expect(service.getStatus().bindHost).toBeNull();
});

it("joins duplicate enable effects and serializes competing LAN bindings", async () => {
  await Promise.all([service.setRemoteAccess(true), service.setRemoteAccess(true)]);
  expect(native.startHost).toHaveBeenCalledOnce();
  await Promise.all([service.setLanAccess(true), service.setLanAccess(false)]);
  expect(native.startHost.mock.calls.map(([options]) => options.host)).toEqual(["127.0.0.1", "0.0.0.0", "127.0.0.1"]);
  expect(hosts.slice(0, 2).every((value) => value.close.mock.calls.length === 1)).toBe(true);
  expect(service.getStatus()).toMatchObject({ remoteAccess: true, lanAccess: false, bindHost: "127.0.0.1" });
});

it("publishes a rotated token only after the old host closes and the new host is ready", async () => {
  await service.setRemoteAccess(true, 9077); await service.setLanAccess(true);
  const previous = service.getStatus().token;
  const old = hosts.at(-1)!;
  let finish!: () => void;
  old.close.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const rotating = service.rotateToken();
  await vi.waitFor(() => expect(old.close).toHaveBeenCalledOnce());
  try {
    expect(service.getStatus()).toMatchObject({ token: null, addresses: [] });
    expect(() => service.createWebLogin("http://127.0.0.1:9077")).toThrow(/Turn on remote access/);
  } finally { finish(); await rotating; }
  expect(service.getStatus()).toMatchObject({ port: 9077, bindHost: "0.0.0.0" });
  expect(service.getStatus().token).not.toBe(previous);
  expect(native.startHost.mock.calls.at(-1)![0].token).toBe(service.getStatus().token);
});

it("cleans a late Tailscale acquisition before shutdown releases its target host", async () => {
  let finish!: () => void;
  native.startServe.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const opening = service.setTailscaleHttps(true).catch(() => undefined);
  await vi.waitFor(() => expect(native.startServe).toHaveBeenCalledOnce());
  const stopping = service.shutdown();
  finish(); await Promise.all([opening, stopping]);
  expect(native.readStatus).not.toHaveBeenCalled();
  expect(native.stopServe).toHaveBeenCalledExactlyOnceWith(443);
  expect(native.stopServe.mock.invocationCallOrder[0]).toBeLessThan(hosts[0].close.mock.invocationCallOrder[0]);
  expect(service.getStatus()).toMatchObject({ tailscale: false, bindHost: null, token: null });
});

it("shares failed shutdown cleanup and allows only cleanup retry afterwards", async () => {
  await service.setRemoteAccess(true);
  hosts[0].close.mockRejectedValueOnce(new Error("Close unavailable"));
  const results = await Promise.allSettled([service.shutdown(), service.shutdown()]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(hosts[0].close).toHaveBeenCalledOnce();
  await expect(service.setRemoteAccess(true)).rejects.toThrow(/shutting down/);
  await service.shutdown();
  expect(hosts[0].close).toHaveBeenCalledTimes(2);
  expect(service.getStatus().bindHost).toBeNull();
});

it("retains the Tailscale loopback target when direct remote access is disabled", async () => {
  await service.setRemoteAccess(true); await service.setLanAccess(true); await service.setTailscaleHttps(true);
  await service.setRemoteAccess(false);
  expect(service.getStatus()).toMatchObject({ remoteAccess: false, lanAccess: false, bindHost: "127.0.0.1", tailscale: true });
  expect(native.stopServe).not.toHaveBeenCalled();
  expect(service.getStatus().addresses.map((address) => address.label)).toEqual(["This machine"]);
});

it("owns one awake lease across AC and battery transitions and releases its listeners at shutdown", async () => {
  await service.setKeepAwakeForRemoteAccess(true); await service.setRemoteAccess(true);
  native.power.emit("on-ac"); native.power.emit("on-ac");
  expect(native.startBlocker).toHaveBeenCalledOnce();
  expect(native.power.listenerCount("on-ac")).toBe(1);
  native.onBattery = true; native.power.emit("on-battery"); native.power.emit("on-battery");
  expect(native.stopBlocker).toHaveBeenCalledOnce();
  native.onBattery = false; native.power.emit("on-ac");
  expect(native.startBlocker).toHaveBeenCalledTimes(2);
  await service.shutdown();
  expect(native.stopBlocker).toHaveBeenCalledTimes(2);
  expect(native.power.listenerCount("on-ac")).toBe(0);
  expect(native.power.listenerCount("on-battery")).toBe(0);
});

it("retains a failed native sleep release for the next power event", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await service.setRemoteAccess(true); await service.setKeepAwakeForRemoteAccess(true);
  const id = native.startBlocker.mock.results[0].value;
  native.stopBlocker.mockImplementationOnce(() => { throw new Error("Sleep stop failed"); });
  native.onBattery = true;
  expect(() => native.power.emit("on-battery")).not.toThrow();
  expect(native.blockers.has(id)).toBe(true);
  native.power.emit("on-battery");
  expect(native.stopBlocker.mock.calls).toEqual([[id], [id]]);
  expect(native.blockers.has(id)).toBe(false);
});

it("releases awake ownership when a LAN rebind loses its native host", async () => {
  await service.setRemoteAccess(true); await service.setKeepAwakeForRemoteAccess(true);
  native.startHost.mockRejectedValueOnce(new Error("Rebind failed"));
  await expect(service.setLanAccess(true)).rejects.toThrow("Rebind failed");
  expect(service.getStatus()).toMatchObject({ bindHost: null, token: null, addresses: [] });
  expect(native.blockers.size).toBe(0);
});

it("retains truthful host ownership if only acquiring the awake lease fails", async () => {
  await service.setKeepAwakeForRemoteAccess(true);
  native.startBlocker.mockImplementationOnce(() => { throw new Error("Awake unavailable"); });
  await expect(service.setRemoteAccess(true)).rejects.toThrow("Awake unavailable");
  expect(service.getStatus()).toMatchObject({ remoteAccess: true, bindHost: "127.0.0.1" });
  expect(service.getStatus().token).not.toBeNull();
  await service.setRemoteAccess(false);
  expect(hosts[0].close).toHaveBeenCalledOnce();
});
