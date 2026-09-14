import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import type { DatabaseInstance } from "../../db/types";

let db: DatabaseInstance;
let cleanup: () => void;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

// Import after mock so it picks up the mocked getDb
import { backendRepo } from "./backend.repo";

function insert(id: string, tokenHash = `hash-${id}`) {
  return backendRepo.insertPairedDevice({
    id,
    name: `Device ${id}`,
    platform: "ios",
    appVersion: null,
    tokenHash,
  });
}

describe("backendRepo (paired devices)", () => {
  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  it("finds an active device by token hash", async () => {
    await insert("d1");
    const found = await backendRepo.findActivePairedDeviceByTokenHash("hash-d1");
    expect(found?.id).toBe("d1");
    expect(
      await backendRepo.findActivePairedDeviceByTokenHash("hash-other"),
    ).toBeNull();
  });

  it("refuses a second device with the same token hash", async () => {
    await insert("d1", "same");
    await expect(insert("d2", "same")).rejects.toThrow();
  });

  it("lists only active devices", async () => {
    await insert("d1");
    await insert("d2");
    expect(await backendRepo.revokePairedDevice("d1")).toBe(true);

    const active = await backendRepo.listActivePairedDevices();
    expect(active.map((d) => d.id)).toEqual(["d2"]);
  });

  it("revoke is a no-op for unknown or already-revoked devices", async () => {
    await insert("d1");
    expect(await backendRepo.revokePairedDevice("missing")).toBe(false);
    expect(await backendRepo.revokePairedDevice("d1")).toBe(true);
    expect(await backendRepo.revokePairedDevice("d1")).toBe(false);
    expect(
      await backendRepo.findActivePairedDeviceByTokenHash("hash-d1"),
    ).toBeNull();
  });

  describe("command receipts", () => {
    it("stores the first result for a device+command and keeps it on conflict", async () => {
      await insert("d1");
      expect(await backendRepo.findCommandReceipt("d1", "c1")).toBeNull();

      await backendRepo.insertCommandReceipt({ deviceId: "d1", commandId: "c1", channel: "runs:continue", result: "first" });
      await backendRepo.insertCommandReceipt({ deviceId: "d1", commandId: "c1", channel: "runs:continue", result: "second" });

      expect(await backendRepo.findCommandReceipt("d1", "c1")).toBe("first");
      expect(await backendRepo.findCommandReceipt("d1", "c2")).toBeNull();
      expect(await backendRepo.findCommandReceipt("d2", "c1")).toBeNull();
    });

    it("prunes receipts older than a cutoff", async () => {
      await insert("d1");
      await backendRepo.insertCommandReceipt({ deviceId: "d1", commandId: "c1", channel: "runs:continue", result: "r" });

      expect(await backendRepo.pruneCommandReceipts(new Date(Date.now() - 60_000))).toBe(0);
      expect(await backendRepo.findCommandReceipt("d1", "c1")).toBe("r");

      expect(await backendRepo.pruneCommandReceipts(new Date(Date.now() + 60_000))).toBe(1);
      expect(await backendRepo.findCommandReceipt("d1", "c1")).toBeNull();
    });
  });

  it("touchPairedDeviceLastSeen stamps the device", async () => {
    await insert("d1");
    expect(
      (await backendRepo.findActivePairedDeviceByTokenHash("hash-d1"))?.lastSeenAt,
    ).toBeNull();

    await backendRepo.touchPairedDeviceLastSeen("d1");

    const seen = (await backendRepo.findActivePairedDeviceByTokenHash("hash-d1"))
      ?.lastSeenAt;
    expect(seen).toBeInstanceOf(Date);
  });
});
