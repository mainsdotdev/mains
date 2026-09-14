import { describe, expect, it, vi } from "vitest";
import {
  getPersistedPlanStatus,
  respondToExitPlanApproval,
  shouldShowPlanActions,
} from "./plan-approval";

describe("respondToExitPlanApproval", () => {
  it("resolves a pending ExitPlanMode request from the plan card", () => {
    const respond = vi.fn();

    expect(
      respondToExitPlanApproval(
        { requestId: "plan-1", toolName: "ExitPlanMode" },
        true,
        respond,
      ),
    ).toBe(true);
    expect(respond).toHaveBeenCalledWith("plan-1", true);
  });

  it("denies the pending ExitPlanMode request when the plan is dismissed", () => {
    const respond = vi.fn();

    expect(
      respondToExitPlanApproval(
        { requestId: "plan-2", toolName: "ExitPlanMode" },
        false,
        respond,
      ),
    ).toBe(true);
    expect(respond).toHaveBeenCalledWith("plan-2", false);
  });

  it("leaves non-plan approvals for the standard approval dialog", () => {
    const respond = vi.fn();

    expect(
      respondToExitPlanApproval(
        { requestId: "edit-1", toolName: "Edit" },
        false,
        respond,
      ),
    ).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });
});

describe("shouldShowPlanActions", () => {
  it("shows a live Claude approval only while ExitPlanMode is actually pending", () => {
    expect(
      shouldShowPlanActions({
        status: "pending",
        interactionMode: "live-approval",
        hasPendingApproval: true,
        isRunActive: true,
      }),
    ).toBe(true);

    expect(
      shouldShowPlanActions({
        status: "pending",
        interactionMode: "live-approval",
        hasPendingApproval: false,
        isRunActive: false,
      }),
    ).toBe(false);
  });

  it("shows follow-up actions only after the planning run finishes", () => {
    expect(
      shouldShowPlanActions({
        status: "pending",
        interactionMode: "follow-up",
        hasPendingApproval: false,
        isRunActive: true,
      }),
    ).toBe(false);

    expect(
      shouldShowPlanActions({
        status: "pending",
        interactionMode: "follow-up",
        hasPendingApproval: false,
        isRunActive: false,
      }),
    ).toBe(true);
  });

  it("never shows actions after the plan was applied, dismissed, or failed", () => {
    for (const status of ["applied", "dismissed", "failed"] as const) {
      expect(
        shouldShowPlanActions({
          status,
          interactionMode: "live-approval",
          hasPendingApproval: true,
          isRunActive: true,
        }),
      ).toBe(false);
    }
  });
});

describe("getPersistedPlanStatus", () => {
  it("prefers durable metadata over the provider-owned legacy output", () => {
    expect(
      getPersistedPlanStatus(
        { planStatus: "applied" },
        { planStatus: "pending" },
      ),
    ).toBe("applied");
  });

  it("marks an errored ExitPlanMode tool call as failed", () => {
    expect(
      getPersistedPlanStatus(
        { status: "error" },
        null,
      ),
    ).toBe("failed");
  });
});
