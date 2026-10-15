import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createProvider, createRun } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import { asyncQuestionMessageId } from "@mains/contracts/async-questions";
import type { ContinueRunPayload } from "./runs.dto";
import { answerAsyncQuestions, dismissAsyncQuestions } from "./run-async-questions";
import { runsRepo } from "./runs.repo";
import { insertRunInputArtifact } from "./run-input-artifact";
import { emitUserPromptArtifact } from "../providers/adapters/adapter.shared";

let db: DatabaseInstance;
let cleanup: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));

beforeEach(() => {
  ({ db, cleanup } = createTestDb());
  createAccount(db, { id: "default" });
  createProvider(db, { id: "codex" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function fixture(status: "running" | "succeeded" | "failed" | "canceled" = "running") {
  const run = createRun(db, { accountId: "default", providerId: "codex", status });
  const questions = [{ title: "Which environment?", options: ["Staging", "Production"] }, { title: "Anything else?", options: null }];
  const artifactId = await runsRepo.insertArtifact({ runId: run.id, kind: "report", content: "Questions",
    metadata: { source: "codex_async_questions", itemId: "native-message", delivery: "async", questions } });
  const payload = { runId: run.id, accountId: run.accountId, artifactId, answers: ["Staging", "Check the logs"] };
  const accept = async (input: Pick<ContinueRunPayload, "runId" | "message" | "clientUserMessageId" | "asyncQuestionReply">) => {
    await emitUserPromptArtifact(async (event) => {
      if (event.type === "artifact") await insertRunInputArtifact(run.id, event);
    }, input.message, { runId: input.runId, clientUserMessageId: input.clientUserMessageId,
      asyncQuestionReply: input.asyncQuestionReply, providerTurnId: "native-turn" });
  };
  const operations = {
    getInputStatus: vi.fn().mockResolvedValue({ accepted: false }),
    steerRun: vi.fn(accept), continueRun: vi.fn(accept),
  };
  return { run, payload, operations, accept };
}

describe("Codex async question answers", () => {
  it.each(["running", "succeeded", "failed", "canceled"] as const)("delivers %s answers with their questions and retains the accepted reply", async (status) => {
    const { payload, operations } = await fixture(status);
    const result = await answerAsyncQuestions({ ...payload, answers: [" Staging ", " Check the logs\n"] }, operations);
    const sender = status === "running" ? operations.steerRun : operations.continueRun;
    expect(sender).toHaveBeenCalledExactlyOnceWith({
      runId: payload.runId, accountId: "default", clientUserMessageId: asyncQuestionMessageId(payload.artifactId),
      message: "Which environment?\n\nStaging\n\n---\n\nAnything else?\n\nCheck the logs",
      asyncQuestionReply: { artifactId: payload.artifactId, answers: payload.answers },
    });
    expect(status === "running" ? operations.continueRun : operations.steerRun).not.toHaveBeenCalled();
    expect(result).toEqual({ accepted: true, answer: { artifactId: payload.artifactId,
      answers: payload.answers, clientUserMessageId: asyncQuestionMessageId(payload.artifactId) } });
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata).toMatchObject({
      source: "codex_async_questions", questions: expect.any(Array), asyncQuestionAnswer: result.answer,
    });
    const receipt = await runsRepo.findInputArtifact(payload.runId, asyncQuestionMessageId(payload.artifactId));
    expect(receipt?.metadata?.asyncQuestionReply).toEqual({ artifactId: payload.artifactId, answers: payload.answers });
    await expect(answerAsyncQuestions(payload, operations)).resolves.toEqual(result);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("shares simultaneous submissions so two clients cannot send the answer twice", async () => {
    const { payload, operations, accept } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    operations.steerRun.mockImplementation(async (input) => { await gate; await accept(input); });
    const first = answerAsyncQuestions(payload, operations);
    await vi.waitFor(() => expect(operations.steerRun).toHaveBeenCalledTimes(1));
    const second = answerAsyncQuestions(payload, operations);
    await Promise.resolve();
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionAnswer).toBeUndefined();
    release();
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(operations.steerRun).toHaveBeenCalledTimes(1);
    expect((await runsRepo.findArtifactsByRun(payload.runId)).filter((row) => row.metadata?.source === "user")).toHaveLength(1);
  });

  it("retains uncertain delivery, checks without resending and recovers a late native echo", async () => {
    const { payload, operations, accept } = await fixture();
    operations.steerRun.mockRejectedValueOnce(new Error("RPC timeout: turn/steer"));
    await expect(answerAsyncQuestions(payload, operations)).rejects.toThrow("Delivery is unknown");
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionAnswer).toBeUndefined();
    await expect(answerAsyncQuestions({ ...payload, checkOnly: true }, operations)).resolves.toEqual({ accepted: false });
    await expect(answerAsyncQuestions(payload, operations)).resolves.toEqual({ accepted: false });
    await expect(answerAsyncQuestions({ ...payload, answers: ["Production", "Changed"] }, operations)).rejects.toThrow("previous answer");
    await expect(answerAsyncQuestions({ ...payload, answers: ["Production", "Changed"], checkOnly: true }, operations)).resolves.toEqual({ accepted: false });
    expect(operations.getInputStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      input: expect.objectContaining({ asyncQuestionReply: { artifactId: payload.artifactId, answers: payload.answers } }),
    }));
    expect(operations.steerRun).toHaveBeenCalledTimes(1);
    await accept(operations.steerRun.mock.calls[0][0]);
    await expect(answerAsyncQuestions({ ...payload, checkOnly: true }, operations)).resolves.toMatchObject({ accepted: true, answer: { answers: payload.answers } });
    expect(operations.steerRun).toHaveBeenCalledTimes(1);
  });

  it("does not let a simultaneous delivery check consume an explicit send", async () => {
    const { payload, operations } = await fixture();
    let release!: (value: { accepted: boolean }) => void;
    operations.getInputStatus.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const checking = answerAsyncQuestions({ ...payload, checkOnly: true }, operations);
    await vi.waitFor(() => expect(operations.getInputStatus).toHaveBeenCalledTimes(1));
    const sending = answerAsyncQuestions(payload, operations);
    await vi.waitFor(() => expect(operations.steerRun).toHaveBeenCalledTimes(1));
    release({ accepted: false });
    await expect(checking).resolves.toEqual({ accepted: false });
    await expect(sending).resolves.toMatchObject({ accepted: true });
  });

  it("recovers the original answers from an accepted prompt when its question update was lost", async () => {
    const { payload, operations } = await fixture();
    await runsRepo.insertArtifact({ runId: payload.runId, kind: "user-prompt" as "report", content: "Original reply",
      metadata: { source: "user", clientUserMessageId: asyncQuestionMessageId(payload.artifactId),
        asyncQuestionReply: { artifactId: payload.artifactId, answers: ["Production", "Original answer"] } } });
    const result = await answerAsyncQuestions(payload, operations);
    expect(result.answer?.answers).toEqual(["Production", "Original answer"]);
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionAnswer).toEqual(result.answer);
    expect(operations.steerRun).not.toHaveBeenCalled();
    expect(operations.getInputStatus).not.toHaveBeenCalled();
  });

  it("continues a turn that finished during the steering preflight", async () => {
    const { payload, operations } = await fixture();
    operations.steerRun.mockImplementationOnce(async () => {
      await runsRepo.updateRun(payload.runId, { status: "succeeded" });
      throw new Error("There is no active turn to steer. The message stays queued.");
    });
    await expect(answerAsyncQuestions(payload, operations)).resolves.toMatchObject({ accepted: true });
    expect(operations.continueRun).toHaveBeenCalledTimes(1);
  });

  it("allows an edited retry after a definitive rejection without marking the question answered", async () => {
    const { payload, operations } = await fixture();
    operations.steerRun.mockRejectedValueOnce(new Error("The provider is not enabled."));
    await expect(answerAsyncQuestions(payload, operations)).rejects.toThrow("not enabled");
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionAnswer).toBeUndefined();
    await expect(answerAsyncQuestions({ ...payload, answers: ["Production", "Retry"] }, operations)).resolves.toMatchObject({ accepted: true });
  });

  it("validates ownership and requires a nonempty answer for each question", async () => {
    const { payload, operations } = await fixture();
    await expect(answerAsyncQuestions({ ...payload, accountId: "another" }, operations)).rejects.toThrow("does not belong");
    const otherRun = createRun(db, { providerId: "codex", accountId: "default" });
    await expect(answerAsyncQuestions({ ...payload, runId: otherRun.id }, operations)).rejects.toThrow("Question not found");
    for (const answers of [["Staging"], ["Staging", " "], ["Staging", "one", "extra"]]) {
      await expect(answerAsyncQuestions({ ...payload, answers }, operations)).rejects.toThrow("Answer every question");
    }
    expect(operations.steerRun).not.toHaveBeenCalled();
    expect(operations.continueRun).not.toHaveBeenCalled();
  });

  it("does not steer the parent on behalf of a subagent question", async () => {
    const { payload, operations } = await fixture();
    const artifactId = await runsRepo.insertArtifact({ runId: payload.runId, kind: "report", content: "Child question",
      metadata: { source: "codex_async_questions", isFromSubagent: true, questions: [{ title: "Branch?", options: null }] } });
    await expect(answerAsyncQuestions({ ...payload, artifactId, answers: ["main"] }, operations)).rejects.toThrow("Question not found");
    expect(operations.steerRun).not.toHaveBeenCalled();
  });

  it("persists dismissal idempotently without sending input and still permits an explicit reply", async () => {
    const { payload, operations } = await fixture("succeeded");
    await dismissAsyncQuestions(payload);
    await dismissAsyncQuestions(payload);
    const question = await runsRepo.findArtifactById(payload.artifactId);
    expect(question?.metadata).toMatchObject({ source: "codex_async_questions", asyncQuestionState: { dismissed: true } });
    expect(question?.metadata?.asyncQuestionAnswer).toBeUndefined();
    expect(await runsRepo.findArtifactsByRun(payload.runId)).toHaveLength(1);
    await expect(dismissAsyncQuestions({ ...payload, accountId: "another" })).rejects.toThrow("does not belong");
    await expect(answerAsyncQuestions(payload, operations)).resolves.toMatchObject({ accepted: true });
    expect(operations.continueRun).toHaveBeenCalledTimes(1);
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionState).toEqual({ dismissed: true });
  });

  it("retires unanswered questions only when an ordinary parent input is accepted", async () => {
    const { payload, operations } = await fixture();
    await dismissAsyncQuestions(payload);
    const childId = await runsRepo.insertArtifact({ runId: payload.runId, kind: "report", content: "Child question",
      metadata: { source: "codex_async_questions", isFromSubagent: true, questions: [{ title: "Branch?", options: null }] } });
    await insertRunInputArtifact(payload.runId, { type: "artifact", kind: "user-prompt", content: "Child input",
      metadata: { isFromSubagent: true } });
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionState).toEqual({ dismissed: true });
    await insertRunInputArtifact(payload.runId, { type: "artifact", kind: "report", content: "Assistant response" });
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionState).toEqual({ dismissed: true });
    const input = { type: "artifact" as const, kind: "user-prompt" as const, content: "A different task",
      metadata: { source: "user", clientUserMessageId: "ordinary-follow-up" } };
    await insertRunInputArtifact(payload.runId, input);
    const accepted = await runsRepo.findInputArtifact(payload.runId, "ordinary-follow-up");
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionState)
      .toEqual({ dismissed: true, supersededBy: accepted!.id });
    expect((await runsRepo.findArtifactById(childId))?.metadata?.asyncQuestionState).toBeUndefined();
    await expect(answerAsyncQuestions(payload, operations)).rejects.toThrow("newer message was sent");
    expect(operations.steerRun).not.toHaveBeenCalled();
    expect(operations.continueRun).not.toHaveBeenCalled();
    // A later question remains independent of the retired one.
    const newId = await runsRepo.insertArtifact({ runId: payload.runId, kind: "report", content: "New question",
      metadata: { source: "codex_async_questions", questions: [{ title: "Now?", options: null }] } });
    await expect(answerAsyncQuestions({ ...payload, artifactId: newId, answers: ["Yes"] }, operations)).resolves.toMatchObject({ accepted: true });
  });

  it("correlates a question reply without retiring other unanswered questions", async () => {
    const { payload, operations } = await fixture();
    const otherId = await runsRepo.insertArtifact({ runId: payload.runId, kind: "report", content: "Another question",
      metadata: { source: "codex_async_questions", questions: [{ title: "Branch?", options: null }] } });
    await expect(answerAsyncQuestions({ ...payload, artifactId: otherId, answers: ["main"] }, operations)).resolves.toMatchObject({ accepted: true });
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionState).toBeUndefined();
    await expect(answerAsyncQuestions(payload, operations)).resolves.toMatchObject({ accepted: true });
    expect(operations.steerRun).toHaveBeenCalledTimes(2);
    await insertRunInputArtifact(payload.runId, { type: "artifact", kind: "user-prompt", content: "Next task" });
    expect((await runsRepo.findArtifactById(otherId))?.metadata?.asyncQuestionState).toBeUndefined();
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionState).toBeUndefined();
  });

  it("rejects legacy stale questions even if their lifecycle metadata was never recorded", async () => {
    const { payload, operations } = await fixture("succeeded");
    await runsRepo.insertArtifact({ runId: payload.runId, kind: "user-prompt" as "report", content: "New task",
      metadata: { source: "user" } });
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata?.asyncQuestionState).toBeUndefined();
    await expect(answerAsyncQuestions(payload, operations)).rejects.toThrow("newer message was sent");
    expect(operations.continueRun).not.toHaveBeenCalled();
  });

  it("rechecks relevance when another accepted message races the delivery lookup", async () => {
    const { payload, operations } = await fixture();
    operations.getInputStatus.mockImplementationOnce(async () => {
      await insertRunInputArtifact(payload.runId, { type: "artifact", kind: "user-prompt", content: "Start another task" });
      return { accepted: false };
    });
    await expect(answerAsyncQuestions(payload, operations)).rejects.toThrow("newer message was sent");
    expect(operations.steerRun).not.toHaveBeenCalled();
  });

  it("still reconciles a late accepted answer after an ordinary input retired its question", async () => {
    const { payload, operations, accept } = await fixture();
    operations.steerRun.mockRejectedValueOnce(new Error("RPC timeout: turn/steer"));
    await expect(answerAsyncQuestions(payload, operations)).rejects.toThrow("Delivery is unknown");
    await insertRunInputArtifact(payload.runId, { type: "artifact", kind: "user-prompt", content: "Another task" });
    await expect(answerAsyncQuestions({ ...payload, checkOnly: true }, operations)).resolves.toEqual({ accepted: false });
    await accept(operations.steerRun.mock.calls[0][0]);
    await expect(answerAsyncQuestions({ ...payload, checkOnly: true }, operations)).resolves.toMatchObject({ accepted: true });
    expect(operations.steerRun).toHaveBeenCalledTimes(1);
    expect((await runsRepo.findArtifactById(payload.artifactId))?.metadata).toMatchObject({
      asyncQuestionState: { supersededBy: expect.any(Number) }, asyncQuestionAnswer: { answers: payload.answers },
    });
  });
});
