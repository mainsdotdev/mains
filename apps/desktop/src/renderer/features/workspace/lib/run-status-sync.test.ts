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
    expect(policy.targetRunId("run-a", "succeeded")).toBe("run-a");
  });

  it("tracks queued runs and ignores events for settled or unknown runs", () => {
    const policy = createRunStatusSyncPolicy([
      { id: "run-a", status: "queued" },
      { id: "run-b", status: "failed" },
    ]);

    expect(policy.listen).toBe(true);
    expect(policy.targetRunId("run-a", "running")).toBe("run-a");
    expect(policy.targetRunId("run-b", "failed")).toBeNull();
    expect(policy.targetRunId("run-c", "running")).toBeNull();
  });

  it("wakes a settled run that starts running again elsewhere", () => {
    // An MCP App message, another window, or a remote client continues a run
    // this window already finished; the renderer only hears it through here.
    const policy = createRunStatusSyncPolicy([
      { id: "run-a", status: "succeeded" },
      { id: "run-b", status: "canceled" },
    ]);

    expect(policy.listen).toBe(true);
    expect(policy.targetRunId("run-a", "running")).toBe("run-a");
    expect(policy.targetRunId("run-b", "queued")).toBe("run-b");
    expect(policy.targetRunId("run-a", "succeeded")).toBeNull();
  });

  it("does not subscribe with no open runs", () => {
    expect(createRunStatusSyncPolicy([]).listen).toBe(false);
  });
});
