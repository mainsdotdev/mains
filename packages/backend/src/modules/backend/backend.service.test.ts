import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../../test/setup-db";
import { appSettings } from "../../db/schema";
import { clearHandlers, registerHandler } from "../../ipc-kit";
import { WS_PROTOCOL_VERSION } from "@mains/contracts/ws-protocol";
import { PENDING_COMMAND_RESULT } from "../../ipc-kit/command-delivery";
import type { DatabaseInstance } from "../../db/types";

let db: DatabaseInstance;
let sqlite: ReturnType<typeof createTestDb>["sqlite"];
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
    ({ db, sqlite, cleanup } = createTestDb());
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
      expect(PAIRED_DEVICE_CHANNELS.has("atlas:readMobileBookmark")).toBe(true);
      for (const channel of ["atlas:mobileLibrary", "atlas:readMobilePage", "atlas:describeMobileFile", "atlas:readMobileFile"]) expect(PAIRED_DEVICE_CHANNELS.has(channel)).toBe(true);
      for (const channel of ["atlas:library", "atlas:get", "atlas:resolveFile", "atlas:update", "atlas:savePage", "atlas:remove"]) expect(PAIRED_DEVICE_CHANNELS.has(channel)).toBe(false);
      expect(PAIRED_DEVICE_CHANNELS.has("search:conversations")).toBe(true);
      expect(PAIRED_DEVICE_CHANNELS.has("search:query")).toBe(false);
      expect(PAIRED_DEVICE_CHANNELS.has("runs:getAll")).toBe(true);
      expect(PAIRED_DEVICE_CHANNELS.has("runs:getQueue")).toBe(true);
      expect(PAIRED_DEVICE_CHANNELS.has("runs:publishQueue")).toBe(false);
      expect(PAIRED_DEVICE_CHANNELS.has("runs:readTextFile")).toBe(true);
      expect(PAIRED_DEVICE_CHANNELS.has("runArtifacts:readAttachmentFile")).toBe(true);
      expect(PAIRED_DEVICE_CHANNELS.has("runArtifacts:describeAttachmentFile")).toBe(true);
      expect(PAIRED_DEVICE_CHANNELS.has("runArtifacts:readAttachmentChunk")).toBe(true);
    });
  });

  describe("PAIRED_DEVICE_COMMANDS", () => {
    it("is exactly the control loop's verbs plus the picker writes, disjoint from the read list", () => {
      expect([...PAIRED_DEVICE_COMMANDS].sort()).toEqual([
        "atlas:editMobileBookmark",
        "atlas:saveMobileBookmark",
        "atlas:saveMobileFile",
        "atlas:updateMobileItem",
        "providers:updateRunSettings",
        "runs:abort",
        "runs:answerAsyncQuestions",
        "runs:continue",
        "runs:createRealtimeConversation",
        "runs:dismissAsyncQuestions",
        "runs:execute",
        "runs:fork",
        "runs:inputStatus",
        "runs:startRealtime",
        "runs:steer",
        "runs:stopRealtime",
        "runs:toolApprovalResponse",
        "runs:updateConversationSettings",
        "space:update",
      ]);
      for (const channel of PAIRED_DEVICE_COMMANDS) {
        expect(PAIRED_DEVICE_CHANNELS.has(channel)).toBe(false);
      }
      expect(PAIRED_DEVICE_COMMANDS.has("runs:update")).toBe(false);
      expect(PAIRED_DEVICE_COMMANDS.has("runs:publishQueue")).toBe(false);
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
      expect(await backendService.commandReceipts.reserve(deviceId, "c1", "runs:continue", PENDING_COMMAND_RESULT)).toBe(true);
      expect(await backendService.commandReceipts.reserve(deviceId, "c1", "runs:continue", PENDING_COMMAND_RESULT)).toBe(false);
      expect(await backendService.commandReceipts.find(deviceId, "c1")).toBe(PENDING_COMMAND_RESULT);
      await backendService.commandReceipts.record(deviceId, "c1", "runs:continue", "{\"success\":true}");
      expect(await backendService.commandReceipts.find(deviceId, "c1")).toBe("{\"success\":true}");
      await expect(backendService.commandReceipts.record(deviceId, "c1", "runs:continue", "replacement")).rejects.toThrow(/no longer pending/);
      expect(await backendService.commandReceipts.find(deviceId, "c1")).toBe("{\"success\":true}");
    });
  });

  describe("createPairingCode", () => {
    it("does not publish a code whose owner was cleared while its descriptor was loading", async () => {
      const creating = backendService.createPairingCode(ENDPOINTS);
      clearPairingCodes();
      await expect(creating).rejects.toThrow(/no longer active/);
    });
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
    it("admits exactly one of concurrent exchanges for the same code", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const outcomes = await Promise.allSettled([
        backendService.pairDevice(phone(code)), backendService.pairDevice(phone(code)),
      ]);
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await backendService.listPairedDevices()).toHaveLength(1);
    });

    it("keeps a code spent after a database failure and allows a newly issued code", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      sqlite.exec("CREATE TRIGGER reject_pair BEFORE INSERT ON paired_devices BEGIN SELECT RAISE(ABORT, 'pairing unavailable'); END");
      await expect(backendService.pairDevice(phone(code))).rejects.toThrow();
      sqlite.exec("DROP TRIGGER reject_pair");
      await expect(backendService.pairDevice(phone(code))).rejects.toThrow(/invalid or has expired/);
      expect(await backendService.listPairedDevices()).toEqual([]);
      const fresh = await backendService.createPairingCode(ENDPOINTS);
      await expect(backendService.pairDevice(phone(fresh.code))).resolves.toMatchObject({ deviceId: expect.any(String) });
    });

    it("revokes its own inserted device when authority retires during the database write", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      sqlite.function("retire_pairing", () => { clearPairingCodes(); return 0; });
      sqlite.exec("CREATE TRIGGER retire_pair AFTER INSERT ON paired_devices BEGIN SELECT retire_pairing(); END");
      await expect(backendService.pairDevice(phone(code))).rejects.toThrow(/no longer active/);
      expect(await backendService.listPairedDevices()).toEqual([]);
      expect(sqlite.prepare("SELECT revoked_at FROM paired_devices").get()).toMatchObject({ revoked_at: expect.any(Number) });
    });

    it("evicts only the oldest of 33 outstanding codes", async () => {
      const codes = [];
      for (let index = 0; index < 33; index++) codes.push(await backendService.createPairingCode(ENDPOINTS));
      await expect(backendService.pairDevice(phone(codes[0].code))).rejects.toThrow(/invalid or has expired/);
      await backendService.pairDevice(phone(codes[1].code));
      await backendService.pairDevice(phone(codes[32].code));
      expect(await backendService.listPairedDevices()).toHaveLength(2);
    });
    it("retires an admitted exchange when pairing authority is cleared before it commits", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const exchanging = backendService.pairDevice(phone(code));
      clearPairingCodes();
      await expect(exchanging).rejects.toThrow(/no longer active/);
      expect(await backendService.listPairedDevices()).toEqual([]);
    });
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
      vi.advanceTimersByTime(CODE_TTL_MS);

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
    it("refuses an earlier verification when revocation starts before it settles", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId, deviceToken } = await backendService.pairDevice(phone(code));
      const verification = backendService.verifyDeviceToken(deviceToken);
      await backendService.revokePairedDevice(deviceId);
      expect(await verification).toBeNull();
      expect(await backendService.verifyDeviceToken(deviceToken)).toBeNull();
    });
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

  describe("renamePairedDevice", () => {
    it("renames a paired device, trimmed", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId } = await backendService.pairDevice(phone(code));

      const renamed = await backendService.renamePairedDevice(
        deviceId,
        "  Okan's iPad  ",
      );

      expect(renamed.name).toBe("Okan's iPad");
      const [device] = await backendService.listPairedDevices();
      expect(device.name).toBe("Okan's iPad");
    });

    it("rejects a blank name and leaves the old one", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId } = await backendService.pairDevice(phone(code));

      await expect(
        backendService.renamePairedDevice(deviceId, "   "),
      ).rejects.toThrow("Device name is required");
      const [device] = await backendService.listPairedDevices();
      expect(device.name).toBe("Okan's iPhone");
    });

    it("caps the name at the pairing length", async () => {
      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId } = await backendService.pairDevice(phone(code));

      const renamed = await backendService.renamePairedDevice(
        deviceId,
        "x".repeat(200),
      );
      expect(renamed.name).toHaveLength(80);
    });

    it("throws for an unknown or revoked device", async () => {
      await expect(
        backendService.renamePairedDevice("missing", "iPad"),
      ).rejects.toThrow("Paired device not found");

      const { code } = await backendService.createPairingCode(ENDPOINTS);
      const { deviceId } = await backendService.pairDevice(phone(code));
      await backendService.revokePairedDevice(deviceId);
      await expect(
        backendService.renamePairedDevice(deviceId, "iPad"),
      ).rejects.toThrow("Paired device not found");
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
      "atlas:changed",
      "providers:modelsUpdated",
      "providers:skillsUpdated",
      "runs:diffUpdated",
      "runs:ephemeralEvent",
      "runs:eventPersisted",
      "runs:queueChanged",
      "runs:realtimeEvent",
      "runs:statusChanged",
      "runs:toolApprovalRequest",
      "runs:toolApprovalResolved",
      "runs:updated",
      "workspace:gitStateChanged",
    ]);
  });
});
