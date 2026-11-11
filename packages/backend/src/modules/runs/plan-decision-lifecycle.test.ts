import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createProvider, createRun, createToolCall } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import { runsRepo } from "./runs.repo";
import { decidePlan } from "./plan-decision-lifecycle";
import { insertRunInputArtifact } from "./run-input-artifact";
let db: DatabaseInstance, cleanup: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
beforeEach(() => { ({ db, cleanup } = createTestDb()); createAccount(db, { id: "default" }); createProvider(db, { id: "codex" }); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); });
function fixture() {
  const run = createRun(db, { accountId: "default", providerId: "codex", status: "succeeded" });
  const plan = createToolCall(db, { runId: run.id, toolName: "Plan", input: JSON.stringify({ plan: "Build it" }), status: "done" });
  const operations = { continueRun: vi.fn(async (input: any) => { await insertRunInputArtifact(run.id, { type: "artifact", kind: "user-prompt", content: input.message, metadata: { source: "user", clientUserMessageId: input.clientUserMessageId } }); }), getInputStatus: vi.fn().mockResolvedValue({ accepted: false }) };
  return { run, plan, operations, payload: { runId: run.id, accountId: "default", toolCallId: plan.id, decision: "apply" as const } };
}
it("keeps a rejected plan pending and permits an explicit retry", async () => {
  const { payload, operations } = fixture(); operations.continueRun.mockRejectedValueOnce(new Error("Provider unavailable"));
  await expect(decidePlan(payload, operations)).rejects.toThrow("unavailable");
  expect((await runsRepo.findToolCallsByRun(payload.runId))[0].metadata?.planStatus).toBeUndefined();
  await expect(decidePlan(payload, operations)).resolves.toEqual({ status: "applied" });
  expect((await runsRepo.findToolCallsByRun(payload.runId))[0].metadata?.planStatus).toBe("applied");
});
it("joins two clients through native acceptance and refuses a competing dismissal", async () => {
  const { payload, operations } = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  operations.continueRun.mockImplementationOnce(async () => { await gate; });
  const first = decidePlan(payload, operations);
  await vi.waitFor(() => expect(operations.continueRun).toHaveBeenCalledTimes(1));
  const second = decidePlan(payload, operations);
  await expect(decidePlan({ ...payload, decision: "dismiss" }, operations)).rejects.toThrow("previous plan decision");
  release(); const results = await Promise.all([first, second]);
  expect(results).toEqual([{ status: "applied" }, { status: "applied" }]);
  expect(operations.continueRun).toHaveBeenCalledTimes(1);
});
it("retries a failed marker without executing the accepted plan twice", async () => {
  const { payload, operations } = fixture();
  vi.spyOn(runsRepo, "updateToolCall").mockRejectedValueOnce(new Error("Database busy"));
  await expect(decidePlan(payload, operations)).rejects.toThrow("accepted");
  await expect(decidePlan({ ...payload, decision: "dismiss" }, operations)).rejects.toThrow("previous plan decision");
  await expect(decidePlan(payload, operations)).resolves.toEqual({ status: "applied" });
  expect(operations.continueRun).toHaveBeenCalledTimes(1);
  await decidePlan(payload, operations); expect(operations.continueRun).toHaveBeenCalledTimes(1);
});
it("checks an uncertain plan delivery without sending a second continuation", async () => {
  const { payload, operations } = fixture();
  operations.continueRun.mockRejectedValueOnce(new Error("RPC timeout: turn/start"));
  await expect(decidePlan(payload, operations)).rejects.toThrow("unknown");
  await expect(decidePlan(payload, operations)).rejects.toThrow("unknown");
  operations.getInputStatus.mockResolvedValueOnce({ accepted: true });
  await expect(decidePlan(payload, operations)).resolves.toEqual({ status: "applied" });
  expect(operations.continueRun).toHaveBeenCalledTimes(1);
});
it("rejects a foreign account and a plan replaced by a newer proposal", async () => {
  const { payload, operations, run } = fixture();
  await expect(decidePlan({ ...payload, accountId: "other" }, operations)).rejects.toThrow("account");
  createToolCall(db, { runId: run.id, toolName: "Plan", input: JSON.stringify({ plan: "Replacement" }), status: "done" });
  await expect(decidePlan(payload, operations)).rejects.toThrow("newer plan");
  expect(operations.continueRun).not.toHaveBeenCalled();
});
it("dismisses a proposal without starting a run and cannot later apply it", async () => {
  const { payload, operations } = fixture();
  await expect(decidePlan({ ...payload, decision: "dismiss" }, operations)).resolves.toEqual({ status: "dismissed" });
  await expect(decidePlan(payload, operations)).rejects.toThrow("already");
  expect(operations.continueRun).not.toHaveBeenCalled();
});
it("never converts an ended live approval into a new continuation", async () => {
  const { payload, operations } = fixture();
  await expect(decidePlan({ ...payload, approvalRequestId: "expired-plan", approvalToken: "old-token" }, operations)).rejects.toThrow("ended");
  expect(operations.continueRun).not.toHaveBeenCalled();
});
it("answers the correlated live permission without launching a continuation", async () => {
  const { requestToolApproval, listPendingApprovals } = await import("./user-input-broker");
  const { payload, operations } = fixture(); await runsRepo.updateRun(payload.runId, { status: "running" });
  const permission = requestToolApproval({ requestId: "live-plan", runId: payload.runId, toolName: "ExitPlanMode", kind: "tool_approval", timestamp: Date.now() });
  const approval = listPendingApprovals(payload.runId)[0];
  await expect(decidePlan({ ...payload, approvalRequestId: approval.requestId, approvalToken: approval.approvalToken }, operations)).resolves.toEqual({ status: "applied" });
  await expect(permission).resolves.toMatchObject({ approved: true }); expect(operations.continueRun).not.toHaveBeenCalled();
});
