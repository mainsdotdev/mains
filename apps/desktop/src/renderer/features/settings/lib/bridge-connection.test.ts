import { describe, expect, it } from "vitest";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { bridgeConnectionDescription } from "./bridge-connection";

const status = (patch: Partial<BridgeStatus>): BridgeStatus => ({ enabled: true, state: "connected", backendId: "a", label: "Mac",
  lastSyncedAt: null, error: null, pendingRecords: 0, backends: [], runs: [], ...patch });

describe("Bridge connection description", () => {
  it("shows upload pacing and queued progress without a paused/error description", () => {
    const retry = "2026-10-27T12:01:00Z";
    expect(bridgeConnectionDescription(status({ state: "syncing", pendingRecords: 600, writeRetryAt: retry })))
      .toBe(`Syncing · 600 changes waiting to sync · Upload limit reached; resuming at ${new Date(retry).toLocaleTimeString()}`);
  });
  it("reports synced changes that were skipped because they could not be applied", () => {
    expect(bridgeConnectionDescription(status({}))).toBe("No pending changes");
    expect(bridgeConnectionDescription(status({ rejectedRecords: 1 })))
      .toBe("No pending changes · 1 change from another device couldn't be applied and was skipped");
    expect(bridgeConnectionDescription(status({ state: "syncing", pendingRecords: 2, rejectedRecords: 3 })))
      .toBe("Syncing · 2 changes waiting to sync · 3 changes from another device couldn't be applied and were skipped");
  });
});
