import { describe, expect, it } from "vitest";
import { mapCodexRuntimeStatus, type CodexRuntimeStatusState } from "./codex-runtime-status";

describe("Codex native runtime statuses", () => {
  function harness() {
    const state: CodexRuntimeStatusState = { turnId: "turn" };
    return { state, map: (method: string, params: Record<string, unknown> = {}) => mapCodexRuntimeStatus(method, { turnId: "turn", ...params }, state, 1000)! };
  }

  it("deduplicates buffering updates, clears the same row, and allows another wait", () => {
    const h = harness();
    const params = { model: "model", showBufferingUi: true, fasterModel: "faster", reasons: ["policy"], useCases: [] };
    const start = h.map("model/safetyBuffering/updated", params)[0];
    expect(start).toMatchObject({ message: expect.stringContaining("checking the response"), metadata: { phase: "start", fasterModel: "faster" } });
    expect(h.map("model/safetyBuffering/updated", params)).toEqual([]);
    const end = h.map("model/safetyBuffering/updated", { ...params, showBufferingUi: false })[0];
    expect(end.metadata?.statusId).toBe(start.metadata?.statusId);
    expect(end.metadata?.phase).toBe("complete");
    expect(h.map("model/safetyBuffering/updated", params)).toHaveLength(1);
  });

  it("shows verification requirements without claiming that a cleared request proves verification", () => {
    const h = harness();
    expect(h.map("model/verification", { verifications: ["trustedAccessForCyber"] })[0]).toMatchObject({ level: "warn", metadata: { phase: "start", status: "required" } });
    expect(h.map("model/verification", { verifications: [] })[0]).toMatchObject({ message: "Codex cleared the account verification request.", metadata: { phase: "complete", status: "cleared" } });
  });

  it.each(["approved", "denied", "timedOut", "aborted"])("projects a %s Guardian decision once and ignores a late start", (status) => {
    const h = harness();
    const params = { reviewId: "review", targetItemId: "command", review: { status: "inProgress", rationale: null } };
    const start = h.map("item/autoApprovalReview/started", params)[0];
    const completed = { ...params, review: { status, rationale: "Native assessment", riskLevel: "high" } };
    const end = h.map("item/autoApprovalReview/completed", completed)[0];
    expect(end.metadata).toMatchObject({ statusId: start.metadata?.statusId, phase: "complete", status, riskLevel: "high" });
    expect(end.message).toContain("Native assessment");
    expect(h.map("item/autoApprovalReview/completed", completed)).toEqual([]);
    expect(h.map("item/autoApprovalReview/started", params)).toEqual([]);
  });

  it("correlates thread-scoped hooks by native id even when a turn starts between events", () => {
    const h = harness();
    h.state.turnId = null;
    const run = { id: "hook", eventName: "preToolUse", status: "running", statusMessage: null };
    const start = h.map("hook/started", { turnId: null, run })[0];
    h.state.turnId = "next-turn";
    const end = h.map("hook/completed", { turnId: null, run: { ...run, status: "blocked", statusMessage: "A package rule blocked this command." } })[0];
    expect(end.metadata?.statusId).toBe(start.metadata?.statusId);
    expect(end).toMatchObject({ level: "warn", message: expect.stringContaining("blocked the action"), metadata: { status: "blocked", phase: "complete" } });
  });

  it("ends missing reviews and hooks honestly when their turn ends, without reacting to retryable errors", () => {
    const h = harness();
    h.map("item/autoApprovalReview/started", { reviewId: "review", review: { status: "inProgress" } });
    h.map("hook/started", { run: { id: "hook", eventName: "preToolUse", status: "running" } });
    expect(h.map("error", { willRetry: true })).toEqual([]);
    const ended = h.map("turn/completed", { turn: { id: "turn", status: "interrupted" } });
    expect(ended).toHaveLength(2);
    expect(ended.every((event) => event.metadata?.status === "interrupted" && event.metadata.phase === "complete")).toBe(true);
    expect(ended.map((event) => event.message).join(" ")).not.toContain("approved");
    expect(h.map("turn/completed")).toEqual([]);
  });

  it("renders recoverable warnings and stricter review requirements as readable notices", () => {
    const h = harness();
    expect(h.map("configWarning", { summary: "A setting was overridden", details: "Managed policy applies" })[0]).toMatchObject({ message: "A setting was overridden", level: "warn" });
    expect(h.map("autoApprovalReview/strictReviewRequired")[0].message).toContain("stricter safety review");
  });
});
