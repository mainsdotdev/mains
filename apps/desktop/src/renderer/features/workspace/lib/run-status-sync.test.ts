import { describe, expect, it } from "vitest";
import { createRunStatusSyncPolicy } from "./run-status-sync";

describe("run status sync policy", () => {
  it("keeps listening for an inactive running tab and routes its completion", () => {
    const policy = createRunStatusSyncPolicy(
      [
        { id: "run-a", status: "running" },
        { id: "run-b", status: "succeeded" },
      ],
    );

    expect(policy.listen).toBe(true);
    expect(policy.targetRunId("run-a")).toBe("run-a");
  });

  it("tracks queued runs and ignores events for settled or unknown runs", () => {
    const policy = createRunStatusSyncPolicy([
      { id: "run-a", status: "queued" },
      { id: "run-b", status: "failed" },
    ]);

    expect(policy.listen).toBe(true);
    expect(policy.targetRunId("run-a")).toBe("run-a");
    expect(policy.targetRunId("run-b")).toBeNull();
    expect(policy.targetRunId("run-c")).toBeNull();
  });

  it("does not subscribe when every open run is settled", () => {
    const policy = createRunStatusSyncPolicy([
      { id: "run-a", status: "succeeded" },
      { id: "run-b", status: "canceled" },
    ]);

    expect(policy.listen).toBe(false);
  });
});
