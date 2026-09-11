import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../../test/setup-db";
import { appSettings } from "../../db/schema";
import { clearHandlers, registerHandler } from "../../ipc-kit";
import { WS_PROTOCOL_VERSION } from "../../../shared/ipc-kit/ws-protocol";
import type { DatabaseInstance } from "../../db/types";

let db: DatabaseInstance;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

// Import after mock so it picks up the mocked getDb
import {
  backendService,
  clearPairingCodes,
  PAIRED_DEVICE_CHANNELS,
  PAIRED_DEVICE_COMMANDS,
  PAIRED_DEVICE_EVENTS,
} from "./backend.service";

const ok = (data: unknown) => ({ success: true as const, data });

const ENDPOINTS = ["https://mac.tailnet.ts.net", "http://192.168.1.5:8787"];
const CODE_TTL_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f-]{36}$/;
const TOKEN = /^[A-Za-z0-9_-]{40,}$/;

function phone(code: string) {
  return {
    code,
    deviceName: "Okan's iPhone",
    platform: "ios",
    appVersion: "0.1.0",
  };
}

function parseLink(link: string) {
  const [base, fragment] = link.split("#");
  const query = new URLSearchParams(fragment);
  return {
    base,
    code: query.get("code"),
    name: query.get("name"),
    endpoints: query.getAll("endpoint"),
  };
}

describe("backendService", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T10:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    clearPairingCodes();
    clearHandlers();
    vi.useRealTimers();
  });

  describe("getBackendId", () => {
    it("mints an id on first use and persists it", async () => {
      const id = await backendService.getBackendId();
      expect(id).toMatch(UUID);

      const row = await db.query.appSettings.findFirst({
        where: eq(appSettings.id, "default"),
      });
      expect(row?.backendId).toBe(id);
    });

    it("returns the same id on every call", async () => {
      const first = await backendService.getBackendId();
      const second = await backendService.getBackendId();
      expect(second).toBe(first);
    });

    it("hands concurrent first callers one shared id", async () => {
      const [a, b, c] = await Promise.all([
        backendService.getBackendId(),
        backendService.getBackendId(),
        backendService.getBackendId(),
      ]);
      expect(a).toBe(b);
      expect(b).toBe(c);
      const row = await db.query.appSettings.findFirst({
        where: eq(appSettings.id, "default"),
      });
      expect(row?.backendId).toBe(a);
    });
  });

  describe("describe", () => {
    it("reports identity, protocol, and the served namespaces", async () => {
      registerHandler("runs:list", async () => ok([]));
      registerHandler("runs:get", async () => ok(null));
      registerHandler("workspace:list", async () => ok([]));

      const descriptor = await backendService.describe();

      expect(descriptor.backendId).toBe(await backendService.getBackendId());
      expect(descriptor.name.length).toBeGreaterThan(0);
      expect(descriptor.name.endsWith(".local")).toBe(false);
      expect(descriptor.appVersion).toBe("0.4.2"); // electron mock in global-setup
      expect(descriptor.protocolVersion).toBe(WS_PROTOCOL_VERSION);
      expect(descriptor.capabilities).toEqual(["runs", "workspace"]);
      expect(descriptor.serverTime).toBe(new Date().toISOString());
    });

    it("lists no capabilities when nothing is registered", async () => {
      const descriptor = await backendService.describe();
      expect(descriptor.capabilities).toEqual([]);
    });

    it("shows a paired device only the namespaces it may reach", async () => {
      registerHandler("runs:getAll", async () => ok([]));
      registerHandler("runs:execute", async () => ok(null));
      registerHandler("terminal:write", async () => ok(null));
      registerHandler("fileExplorer:readFile", async () => ok(null));

      expect((await backendService.describe()).capabilities).toEqual([
        "fileExplorer",
        "runs",
        "terminal",
      ]);
      expect(
        (await backendService.describe({ pairedDevice: true })).capabilities,
      ).toEqual(["runs"]);
    });
  });

  describe("PAIRED_DEVICE_CHANNELS", () => {
    it("is read-only: no mutation, terminal, or filesystem channel", () => {
      for (const channel of PAIRED_DEVICE_CHANNELS) {
        expect(channel).not.toMatch(
          /^(terminal|fileExplorer|gitFlow|ssh|localBackend|remoteBackends|appSettings):/,
        );
        expect(channel).not.toMatch(
          /:(execute|continue|fork|create|update|delete|abort|cancel|archive|start|add|remove|respond)/,
        );
      }
      expect(PAIRED_DEVICE_CHANNELS.has("backend:describe")).toBe(true);
      expect(PAIRED_DEVICE_CHANNELS.has("runs:getAll")).toBe(true);
    });
  });

  describe("PAIRED_DEVICE_COMMANDS", () => {
    it("is exactly the control loop's verbs plus the picker writes, disjoint from the read list", () => {
      expect([...PAIRED_DEVICE_COMMANDS].sort()).toEqual([
        "providers:updateRunSettings",
        "runs:abort",
        "runs:continue",
        "runs:execute",
        "runs:fork",
        "runs:toolApprovalResponse",
        "space:update",
      ]);
      for (const channel of PAIRED_DEVICE_COMMANDS) {
        expect(PAIRED_DEVICE_CHANNELS.has(channel)).toBe(false);
      }
    });

    it("counts toward a paired device's capabilities", async () => {
      registerHandler("runs:continue", async () => ok(null));
      registerHandler("terminal:write", async () => ok(null));
      expect(
        (await backendService.describe({ pairedDevice: true })).capabilities,
      ).toEqual(["runs"]);
    });
  });

  describe("commandReceipts", () => {
    it("records and finds a device's command result", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId } = await backendService.pairDevice(phone(code));

      expect(await backendService.commandReceipts.find(deviceId, "c1")).toBeNull();
      await backendService.commandReceipts.record(deviceId, "c1", "runs:continue", "{\"success\":true}");
      expect(await backendService.commandReceipts.find(deviceId, "c1")).toBe("{\"success\":true}");
    });
  });

  describe("createPairingCode", () => {
    it("refuses when the phone would have nothing to reach", async () => {
      await expect(backendService.createPairingCode([])).rejects.toThrow(
        /network access or Tailscale/,
      );
    });

    it("mints a code and a link carrying it, the backend name, and the endpoints", async () => {
      const issued = await backendService.createPairingCode(ENDPOINTS);

      expect(issued.code).toMatch(TOKEN);
      expect(issued.expiresAt.getTime()).toBe(Date.now() + CODE_TTL_MS);

      const link = parseLink(issued.link);
      expect(link.base).toBe("mains://pair");
      expect(link.code).toBe(issued.code);
      expect(link.name).toBe((await backendService.describe()).name);
      expect(link.endpoints).toEqual(ENDPOINTS);
    });
  });

  describe("pairDevice", () => {
    it("exchanges a live code for a device token and the descriptor", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);

      const result = await backendService.pairDevice(phone(code));

      expect(result.deviceId).toMatch(UUID);
      expect(result.deviceToken).toMatch(TOKEN);
      expect(result.backend.backendId).toBe(await backendService.getBackendId());

      const devices = await backendService.listPairedDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({
        id: result.deviceId,
        name: "Okan's iPhone",
        platform: "ios",
        appVersion: "0.1.0",
        lastSeenAt: null,
      });
      expect(devices[0]).not.toHaveProperty("tokenHash");
    });

    it("spends the code on first use", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      await backendService.pairDevice(phone(code));

      await expect(backendService.pairDevice(phone(code))).rejects.toThrow(
        /invalid or has expired/,
      );
      expect(await backendService.listPairedDevices()).toHaveLength(1);
    });

    it("rejects a code it never issued", async () => {
      await backendService.createPairingCode(ENDPOINTS);
      await expect(
        backendService.pairDevice(phone("not-a-real-code")),
      ).rejects.toThrow(/invalid or has expired/);
    });

    it("rejects a code past its five minutes", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      vi.advanceTimersByTime(CODE_TTL_MS + 1);

      await expect(backendService.pairDevice(phone(code))).rejects.toThrow(
        /invalid or has expired/,
      );
    });

    it("keeps a code unspent when the body is malformed", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);

      await expect(backendService.pairDevice({ code })).rejects.toThrow(
        /Device name/,
      );
      await expect(backendService.pairDevice(phone(code))).resolves.toMatchObject(
        { deviceId: expect.stringMatching(UUID) },
      );
    });

    it("lets several codes be outstanding, each single-use", async () => {
      const first = await backendService.createPairingCode(ENDPOINTS);
      const second = await backendService.createPairingCode(ENDPOINTS);

      await backendService.pairDevice(phone(second.code));
      await backendService.pairDevice(phone(first.code));

      expect(await backendService.listPairedDevices()).toHaveLength(2);
    });
  });

  describe("verifyDeviceToken", () => {
    it("resolves a live token to its device and records the sighting", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId, deviceToken } = await backendService.pairDevice(
        phone(code),
      );

      const access = await backendService.verifyDeviceToken(deviceToken);
      expect(access?.deviceId).toBe(deviceId);
      expect(access?.channels).toBe(PAIRED_DEVICE_CHANNELS);
      expect(access?.commandChannels).toBe(PAIRED_DEVICE_COMMANDS);

      const [device] = await backendService.listPairedDevices();
      expect(device.lastSeenAt).not.toBeNull();
    });

    it("returns null for a token it never issued", async () => {
      expect(await backendService.verifyDeviceToken("nope")).toBeNull();
    });

    it("returns null once the device is revoked", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId, deviceToken } = await backendService.pairDevice(
        phone(code),
      );

      await backendService.revokePairedDevice(deviceId);

      expect(await backendService.verifyDeviceToken(deviceToken)).toBeNull();
      expect(await backendService.listPairedDevices()).toEqual([]);
    });
  });

  describe("revokePairedDevice", () => {
    it("throws for an unknown device", async () => {
      await expect(backendService.revokePairedDevice("missing")).rejects.toThrow(
        "Paired device not found",
      );
    });

    it("throws when revoking twice", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId } = await backendService.pairDevice(phone(code));

      await backendService.revokePairedDevice(deviceId);
      await expect(backendService.revokePairedDevice(deviceId)).rejects.toThrow(
        "Paired device not found",
      );
    });
  });
});

describe("PAIRED_DEVICE_EVENTS", () => {
  it("is exactly the pushes the phone subscribes to", () => {
    expect([...PAIRED_DEVICE_EVENTS].sort()).toEqual([
      "providers:modelsUpdated",
      "runs:diffUpdated",
      "runs:ephemeralEvent",
      "runs:eventPersisted",
      "runs:statusChanged",
      "runs:toolApprovalRequest",
      "runs:toolApprovalResolved",
      "runs:updated",
      "workspace:gitStateChanged",
    ]);
  });
});
