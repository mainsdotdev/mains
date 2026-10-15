import {
  asyncQuestionMessageId, formatAsyncQuestionReply, readAsyncQuestionAnswer,
  readAsyncQuestionReply, readAsyncQuestions, readAsyncQuestionState,
  type AnswerAsyncQuestionsPayload, type AnswerAsyncQuestionsResponse,
  type AsyncQuestionReply, type DismissAsyncQuestionsPayload,
} from "@mains/contracts/async-questions";
import type { RunInputStatusPayload, RunSteerPayload } from "@mains/contracts/runs";
import { CHANNELS } from "@mains/contracts/channels";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { emit } from "../../ipc-kit";
import { runsRepo } from "./runs.repo";
import type { ContinueRunPayload } from "./runs.dto";
import { runSessionRegistry } from "./run-session-registry";

interface AnswerOperations {
  steerRun(payload: RunSteerPayload): Promise<unknown>;
  continueRun(payload: ContinueRunPayload): Promise<unknown>;
  getInputStatus(payload: RunInputStatusPayload): Promise<{ accepted: boolean }>;
}

// Shared by every client of this backend. A lost receipt never permits a resend.
const submissions = new Map<string, {
  reply: AsyncQuestionReply;
  uncertain: boolean;
  promise?: Promise<AnswerAsyncQuestionsResponse>;
}>();

async function findQuestion(payload: DismissAsyncQuestionsPayload) {
  const run = await runsRepo.findRunById(payload.runId);
  if (!run) throw new Error("Run not found");
  if (run.accountId !== payload.accountId) throw new Error("Run does not belong to this account");
  if (run.providerId !== PROVIDER_IDS.codex) throw new Error("Async questions are only supported by Codex.");
  if (!Number.isSafeInteger(payload.artifactId) || payload.artifactId <= 0) throw new Error("Invalid question.");
  const artifact = await runsRepo.findArtifactById(payload.artifactId);
  if (!artifact || artifact.runId !== run.id || artifact.metadata?.source !== "codex_async_questions" ||
      artifact.metadata.isFromSubagent === true) throw new Error("Question not found in this conversation.");
  return { run, metadata: artifact.metadata };
}

export async function dismissAsyncQuestions(payload: DismissAsyncQuestionsPayload): Promise<void> {
  await findQuestion(payload);
  if (await runsRepo.dismissAsyncQuestions(payload.runId, payload.artifactId)) {
    emit(CHANNELS.runs.eventPersisted, { runId: payload.runId });
  }
}

/** Recheck at the native send seam too, so a stale client cannot steer new work. */
export async function assertAsyncQuestionCanReply(runId: string, reply: AsyncQuestionReply): Promise<void> {
  const artifact = await runsRepo.findArtifactById(reply.artifactId);
  if (!artifact || artifact.runId !== runId || artifact.metadata?.source !== "codex_async_questions" ||
      artifact.metadata.isFromSubagent === true) throw new Error("Question not found in this conversation.");
  if (readAsyncQuestionState(artifact.metadata.asyncQuestionState).supersededBy ||
      await runsRepo.findAsyncQuestionSupersedingInput(runId, reply.artifactId)) {
    throw new Error("This question no longer needs an answer because a newer message was sent.");
  }
}

export async function answerAsyncQuestions(
  payload: AnswerAsyncQuestionsPayload,
  operations: AnswerOperations,
): Promise<AnswerAsyncQuestionsResponse> {
  const { run, metadata } = await findQuestion(payload);
  const saved = readAsyncQuestionAnswer(metadata.asyncQuestionAnswer);
  if (saved) {
    submissions.delete(JSON.stringify([run.id, payload.artifactId]));
    return { accepted: true, answer: saved };
  }
  const questions = readAsyncQuestions(metadata.questions);
  const reply = readAsyncQuestionReply(payload);
  if (!reply || !questions.length || reply.answers.length !== questions.length) {
    throw new Error("Answer every question before sending.");
  }
  const key = JSON.stringify([run.id, reply.artifactId]);
  const previous = submissions.get(key);
  if (previous && !payload.checkOnly && JSON.stringify(previous.reply.answers) !== JSON.stringify(reply.answers)) {
    throw new Error("The previous answer is still being delivered. Check its delivery before changing it.");
  }
  if (previous?.promise) return previous.promise;
  const submission = previous ?? { reply, uncertain: false };
  // A read-only check must not consume another client's explicit Send action.
  if (previous || !payload.checkOnly) submissions.set(key, submission);
  const clientUserMessageId = asyncQuestionMessageId(reply.artifactId);
  const message = formatAsyncQuestionReply(questions, submission.reply.answers);
  const input = { message, asyncQuestionReply: submission.reply };

  const record = async (acceptedReply: AsyncQuestionReply): Promise<AnswerAsyncQuestionsResponse> => {
    const answer = { ...acceptedReply, clientUserMessageId };
    if (await runsRepo.recordAsyncQuestionAnswer(run.id, answer)) emit(CHANNELS.runs.eventPersisted, { runId: run.id });
    if (submissions.get(key) === submission) submissions.delete(key);
    return { accepted: true, answer };
  };

  submission.promise = (async () => {
    let invoked = false;
    let accepted = false;
    try {
      // A persisted prompt is authoritative, including after a backend restart.
      const receipt = await runsRepo.findInputArtifact(run.id, clientUserMessageId);
      if (receipt) {
        accepted = true;
        return await record(readAsyncQuestionReply(receipt.metadata?.asyncQuestionReply) ?? submission.reply);
      }
      if ((await operations.getInputStatus({
        runId: run.id, accountId: run.accountId, clientUserMessageId, input,
      })).accepted) {
        accepted = true;
        return await record(submission.reply);
      }
      if (payload.checkOnly || submission.uncertain) return { accepted: false };
      await assertAsyncQuestionCanReply(run.id, submission.reply);
      if (run.isArchived) throw new Error("Unarchive this conversation before sending a message.");
      const current = await runsRepo.findRunById(run.id);
      if (!current) throw new Error("Run not found");
      const send = { runId: run.id, accountId: run.accountId, clientUserMessageId, ...input };
      invoked = true;
      if (current.status === "running") {
        try {
          await operations.steerRun(send);
        } catch (error) {
          // These preflight failures did not send input. A finished turn can
          // accept the same answer as a continuation instead.
          const text = error instanceof Error ? error.message : String(error);
          if (!/no active turn to steer|active turn changed|no active Codex turn to steer/i.test(text)) throw error;
          const latest = await runsRepo.findRunById(run.id);
          if (!latest || latest.status === "running" || latest.status === "queued" || runSessionRegistry.get(run.id)) throw error;
          await assertAsyncQuestionCanReply(run.id, submission.reply);
          await operations.continueRun(send);
        }
      } else {
        await operations.continueRun(send);
      }
      accepted = true;
      return await record(submission.reply);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (accepted || invoked && /timeout|timed out|disconnect|offline|exited|stopping|socket|connection|transport|delivery is unknown|already being sent/i.test(text)) {
        submission.uncertain = true;
        throw new Error(`Delivery is unknown. Check delivery before sending again. ${text}`);
      }
      if (submissions.get(key) === submission) submissions.delete(key);
      throw error;
    } finally {
      submission.promise = undefined;
      if (!submission.uncertain && submissions.get(key) === submission) submissions.delete(key);
    }
  })();
  return submission.promise;
}
