import type { RunEvent } from "../types";
import { readAsyncQuestionAnswer } from "@mains/contracts/async-questions";
import { assistantToolResult } from "./assistant-tool-content";
import { parseToolContent } from "./parse-tool-content";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionParams {
  questions?: UserQuestion[];
  question?: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface UserQuestionEntry {
  question: UserQuestion;
  answer?: string | string[];
  unanswered?: string;
}

const unansweredLabels: Record<string, string> = {
  dismissed: "Dismissed",
  skipped: "Skipped",
  replied_in_chat: "Answered in chat",
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readQuestion(value: unknown): UserQuestion[] {
  const item = record(value);
  if (!item || typeof item.question !== "string" || !item.question.trim()) return [];
  const options = Array.isArray(item.options) ? item.options.flatMap((value): QuestionOption[] => {
    const option = record(value);
    if (!option || typeof option.label !== "string" || !option.label.trim()) return [];
    return [{ label: option.label, description: typeof option.description === "string" ? option.description : undefined }];
  }) : undefined;
  return [{ question: item.question, header: typeof item.header === "string" ? item.header : undefined,
    options, multiSelect: item.multiSelect === true }];
}

function questionsIn(value: unknown): UserQuestion[] {
  return Array.isArray(value) ? value.flatMap(readQuestion) : [];
}

function readAnswer(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (Array.isArray(value)) {
    const answers = value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim());
    if (answers.length) return answers;
  }
  return undefined;
}

export function readUserQuestionEntries(params: unknown, output: unknown): UserQuestionEntry[] {
  const input = record(params);
  const value = assistantToolResult(output);
  const result = record(value);
  const returnedQuestions = questionsIn(result?.questions);
  const inputQuestions = questionsIn(input?.questions);
  const singleQuestion = readQuestion(input);
  const questions = returnedQuestions.length ? returnedQuestions
    : inputQuestions.length ? inputQuestions : singleQuestion.length ? singleQuestion : readQuestion(result);
  const answers = record(result?.answers);
  const annotations = record(result?.annotations);
  // Native Claude keys answers by question. Other providers use an index
  // or return a single answer from the waiting tool.
  const response = [value, result?.content, result?.detailedContent].find(
    (item): item is string => typeof item === "string" && /^User responded:/i.test(item),
  )?.replace(/^User responded:\s*/i, "");
  return questions.map((question, index) => {
    const key = question.question;
    const reason = record(annotations?.[key])?.unanswered;
    const unanswered = typeof reason === "string" && Object.prototype.hasOwnProperty.call(unansweredLabels, reason)
      ? unansweredLabels[reason] : result?.status === "canceled" ? "Unanswered" : undefined;
    const answer = unanswered || input?.isSecret === true ? undefined : readAnswer(answers?.[key] ?? answers?.[String(index)]
      ?? (index === 0 ? result?.answer ?? response : undefined));
    return { question, answer, unanswered };
  });
}

export function pickedQuestionOptions({ question, answer }: UserQuestionEntry): QuestionOption[] {
  if (answer === undefined || !question.options?.length) return [];
  const labels = Array.isArray(answer) ? answer
    : question.multiSelect && !question.options.some(option => option.label === answer) ? answer.split(", ") : [answer];
  return labels.every(label => question.options?.some(option => option.label === label))
    ? question.options.filter(option => labels.includes(option.label)) : [];
}

export function isUserQuestionTool(event: RunEvent): boolean {
  if (event.type !== "tool_call") return false;
  const toolName = typeof event.metadata?.toolName === "string" ? event.metadata.toolName : event.content.split(":")[0];
  return ["askassistantquestion", "askuserquestion", "ask_user", "askuser", "userinput", "request_user_input"]
    .includes(toolName.trim().toLowerCase().replace(/^mcp__mains__/, ""));
}

export function readQuestionToolEntries(event: RunEvent): UserQuestionEntry[] {
  const entries = readUserQuestionEntries(event.metadata?.input ?? parseToolContent(event.content).params, event.metadata?.output);
  const status = event.metadata?.status;
  if (status !== "canceled" && status !== "error") return entries;
  return entries.map(entry => entry.answer || entry.unanswered ? entry : { ...entry, unanswered: "Unanswered" });
}

export function readQuestionReplyEvent(event: RunEvent) {
  if (event.type !== "artifact" || event.metadata?.kind !== "user-prompt") return null;
  const reply = record(event.metadata.asyncQuestionReply);
  return reply ? readAsyncQuestionAnswer({ ...reply, clientUserMessageId: event.metadata.clientUserMessageId }) : null;
}
