import type { WorkRunEvent } from "../../../shared/adapter.types";
import { runsRepo } from "./runs.repo";
import type { RunArtifactKind } from "./runs.dto";
import { createHash } from "node:crypto";
import { asyncQuestionMessageId, readAsyncQuestionReply } from "@mains/contracts/async-questions";
import { assistantTaskInput } from "../assistants";

const pendingInputs = new Map<string, Promise<boolean>>();

/** ACK, echo and uncertain-delivery recovery share one existing artifact row. */
export async function insertRunInputArtifact(
  runId: string,
  event: Extract<WorkRunEvent, { type: "artifact" }>,
  /** Run only for a new input, e.g. to create and stamp its native turn boundary. */
  prepare?: () => Promise<Extract<WorkRunEvent, { type: "artifact" }>>,
): Promise<boolean> {
  const id = event.kind === "user-prompt" && typeof event.metadata?.clientUserMessageId === "string"
    ? event.metadata.clientUserMessageId
    : undefined;
  const key = id ? JSON.stringify([runId, id]) : undefined;
  if (key && pendingInputs.has(key)) {
    await pendingInputs.get(key);
    return false;
  }
  const insert = (async () => {
    if (id && (await runsRepo.findArtifactsByRun(runId)).some((artifact) => artifact.metadata?.clientUserMessageId === id)) {
      return false;
    }
    if (prepare) event = await prepare();
    if (event.kind === "user-prompt") {
      const taskInput = assistantTaskInput(runId, event.content, event.metadata);
      // Preserve the actual prompt and turn boundary; presentation uses the correlated task identity.
      if (taskInput) event.metadata = { ...event.metadata, assistantTaskInput: taskInput };
    }
    const artifactId = await runsRepo.insertArtifact({
      runId,
      kind: event.kind as RunArtifactKind,
      path: event.path,
      content: event.content,
      metadata: event.metadata,
      contentHash: event.content ? createHash("sha256").update(event.content).digest("hex") : undefined,
    });
    // Recovered voice speech belongs to history and cannot answer or supersede a newer question.
    if (event.kind === "user-prompt" && event.metadata?.isFromSubagent !== true && event.metadata?.voiceRecovered !== true) {
      const reply = readAsyncQuestionReply(event.metadata?.asyncQuestionReply);
      if (reply && id === asyncQuestionMessageId(reply.artifactId)) {
        await runsRepo.recordAsyncQuestionAnswer(runId, { ...reply, clientUserMessageId: id });
      } else {
        await runsRepo.supersedeAsyncQuestions(runId, artifactId);
      }
    }
    return true;
  })();
  if (key) pendingInputs.set(key, insert);
  try {
    return await insert;
  } finally {
    if (key) pendingInputs.delete(key);
  }
}
