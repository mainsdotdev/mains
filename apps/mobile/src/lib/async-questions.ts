import {
  asyncQuestionMessageId,
  readAsyncQuestionAnswer,
  readAsyncQuestionReply,
  readAsyncQuestionState,
  readAsyncQuestions,
  type AsyncQuestion,
} from "@mains/contracts/async-questions";

import type { RunArtifactRow } from "@/db/schema";

/** Questions Codex asked at the end of a turn, still waiting on the user. */
export interface PendingAsyncQuestions {
  /** The question artifact; answers and dismissals are recorded against it. */
  artifactId: number;
  questions: AsyncQuestion[];
}

type QuestionSource = Pick<RunArtifactRow, "id" | "kind" | "metadataJson">;

function metadataOf(artifact: QuestionSource): Record<string, unknown> {
  if (!artifact.metadataJson) return {};
  try {
    const parsed: unknown = JSON.parse(artifact.metadataJson);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The newest Codex questions the user can still answer, by the desktop's
 * `AsyncQuestionDialogProvider` rules: a top-level `codex_async_questions`
 * artifact that is neither answered nor dismissed, with no ordinary user
 * message after it — writing something else moves the conversation on. The
 * prompt that answers a question is not ordinary.
 *
 * Takes artifacts newest first, the order the history window is read in.
 */
export function pendingAsyncQuestions(
  newestFirst: readonly QuestionSource[],
): PendingAsyncQuestions | null {
  for (const artifact of newestFirst) {
    const meta = metadataOf(artifact);
    if (meta.isFromSubagent === true) continue;
    if (artifact.kind === "user-prompt") {
      const reply = readAsyncQuestionReply(meta.asyncQuestionReply);
      const answersQuestion = reply !== null &&
        meta.clientUserMessageId === asyncQuestionMessageId(reply.artifactId);
      if (!answersQuestion) return null;
      continue;
    }
    if (meta.source !== "codex_async_questions" || artifact.id <= 0) continue;
    const questions = readAsyncQuestions(meta.questions);
    if (questions.length === 0) continue;
    const state = readAsyncQuestionState(meta.asyncQuestionState);
    if (readAsyncQuestionAnswer(meta.asyncQuestionAnswer) || state.dismissed || state.supersededBy) continue;
    return { artifactId: artifact.id, questions };
  }
  return null;
}
