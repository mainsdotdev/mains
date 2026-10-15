/** Codex delivers these questions as part of a completed agentMessage. */
export interface AsyncQuestion {
  title: string;
  options: string[] | null;
}

export interface AsyncQuestionReply {
  artifactId: number;
  answers: string[];
}

export interface AsyncQuestionAnswer extends AsyncQuestionReply {
  clientUserMessageId: string;
}

/** Persisted on the original question artifact; answer drafts stay local. */
export interface AsyncQuestionState {
  dismissed?: boolean;
  supersededBy?: number;
}

export interface DismissAsyncQuestionsPayload {
  runId: string;
  accountId: string;
  artifactId: number;
}

export interface AnswerAsyncQuestionsPayload extends AsyncQuestionReply {
  runId: string;
  accountId: string;
  /** Reconcile an uncertain delivery without sending the answer again. */
  checkOnly?: boolean;
}

export interface AnswerAsyncQuestionsResponse {
  accepted: boolean;
  answer?: AsyncQuestionAnswer;
}

export function readAsyncQuestionState(value: unknown): AsyncQuestionState {
  if (!value || typeof value !== "object") return {};
  const { dismissed, supersededBy } = value as Record<string, unknown>;
  return {
    ...(dismissed === true ? { dismissed: true } : {}),
    ...(typeof supersededBy === "number" && Number.isSafeInteger(supersededBy) && supersededBy > 0
      ? { supersededBy } : {}),
  };
}

export function readAsyncQuestions(value: unknown): AsyncQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { title, options } = entry as Record<string, unknown>;
    if (typeof title !== "string" || !title.trim()) return [];
    return [{
      title: title.trim(),
      options: Array.isArray(options) ? options.flatMap((option) =>
        typeof option === "string" && option.trim() ? [option.trim()] : []) : null,
    }];
  });
}

export function readAsyncQuestionReply(value: unknown): AsyncQuestionReply | null {
  if (!value || typeof value !== "object") return null;
  const { artifactId, answers } = value as Record<string, unknown>;
  if (typeof artifactId !== "number" || !Number.isSafeInteger(artifactId) || artifactId <= 0 ||
      !Array.isArray(answers) || !answers.length ||
      !answers.every((answer) => typeof answer === "string" && answer.trim())) return null;
  return { artifactId, answers: answers.map((answer: string) => answer.trim()) };
}

export function asyncQuestionMessageId(artifactId: number): string {
  return `codex-async-answer-${artifactId}`;
}

export function readAsyncQuestionAnswer(value: unknown): AsyncQuestionAnswer | null {
  const reply = readAsyncQuestionReply(value);
  if (!reply || (value as Record<string, unknown>).clientUserMessageId !== asyncQuestionMessageId(reply.artifactId)) return null;
  return { ...reply, clientUserMessageId: asyncQuestionMessageId(reply.artifactId) };
}

export function formatAsyncQuestionReply(questions: AsyncQuestion[], answers: string[]): string {
  return questions.map((question, index) =>
    `${question.title}\n\n${answers[index]}`).join("\n\n---\n\n");
}
