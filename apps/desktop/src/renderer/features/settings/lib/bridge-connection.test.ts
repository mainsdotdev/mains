import { describe, expect, it } from "vitest";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { bridgeConnectionDescription } from "./bridge-connection";

const status = (patch: Partial<BridgeStatus>): BridgeStatus => ({ enabled: true, state: "connected", backendId: "a", label: "Mac",
  lastSyncedAt: null, error: null, pendingRecords: 0, backends: [], runs: [], ...patch });

describe("Bridge connection description", () => {
  it("reports synced changes that were skipped because they could not be applied", () => {
    expect(bridgeConnectionDescription(status({}))).toBe("No pending changes");
    expect(bridgeConnectionDescription(status({ rejectedRecords: 1 })))
      .toBe("No pending changes · 1 change from another device couldn't be applied and was skipped");
    expect(bridgeConnectionDescription(status({ state: "syncing", pendingRecords: 2, rejectedRecords: 3 })))
      .toBe("Syncing · 2 changes waiting to sync · 3 changes from another device couldn't be applied and were skipped");
  });
});
