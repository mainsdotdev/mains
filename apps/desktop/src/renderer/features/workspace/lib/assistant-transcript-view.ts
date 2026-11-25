import { readAssistantTaskInput } from "@mains/contracts/assistants";
import { readAsyncQuestionAnswer, readAsyncQuestions, type AsyncQuestionAnswer } from "@mains/contracts/async-questions";
import type { EventGroup } from "./group-events";
import type { RunEvent } from "../types";
import { isUserQuestionTool, readQuestionReplyEvent } from "./user-question-content";

function isConversationEvent(event: RunEvent): boolean {
  if (event.type === "artifact") {
    if (event.metadata?.outputSelected !== true && (event.metadata?.working === true || event.metadata?.viewed === true)) return false;
    const taskInput = readAssistantTaskInput(event.metadata?.assistantTaskInput);
    return !taskInput || taskInput.kind === "request";
  }
  // Keep failures actionable while omitting provider lifecycle diagnostics.
  if (event.type === "log") return event.metadata?.level === "warn" || event.metadata?.level === "error";
  return event.type === "tool_call" && !!event.metadata?.mcpApp;
}

function asyncQuestionId(event: RunEvent): number | undefined {
  if (event.type !== "artifact" || event.metadata?.source !== "codex_async_questions") return undefined;
  const id = Number(/^artifact-(\d+)$/.exec(event.id)?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Presentation only: the full transcript still backs tools, questions and history. */
export function assistantTranscriptGroups(groups: EventGroup[]): EventGroup[] {
  const questionCounts = new Map<number, number>();
  const replies = new Map<number, AsyncQuestionAnswer>();
  for (const group of groups) for (const event of group.events) {
    const questionId = asyncQuestionId(event);
    if (questionId !== undefined && isConversationEvent(event)) {
      const questions = readAsyncQuestions(event.metadata?.questions);
      if (questions.length) questionCounts.set(questionId, questions.length);
    }
    const reply = readQuestionReplyEvent(event);
    if (reply) replies.set(reply.artifactId, reply);
  }

  return groups.flatMap(group => {
    if (group.type === "context_compaction") return [];
    if (group.type === "tool_calls") return group.events.filter(isUserQuestionTool).map(event => ({
      id: `question-${event.id}`, type: "info" as const, events: [event], startTime: event.timestamp, endTime: event.timestamp,
    }));
    const events = group.events.filter(isConversationEvent);
    if (!events.length) return [];
    const first = events[0];
    const questionId = asyncQuestionId(first);
    const receipt = questionId === undefined ? undefined : replies.get(questionId);
    const confirmed = receipt && readAsyncQuestionAnswer(first.metadata?.asyncQuestionAnswer);
    if (receipt && questionCounts.get(receipt.artifactId) === receipt.answers.length &&
        (confirmed?.artifactId !== questionId || confirmed?.answers.length !== receipt.answers.length)) {
      return [{ ...group, events: [{ ...first, metadata: { ...first.metadata, asyncQuestionAnswer: receipt } }] }];
    }
    const reply = readQuestionReplyEvent(first);
    if (reply && questionCounts.get(reply.artifactId) === reply.answers.length) return [{ ...group, representedByQuestion: true }];
    return events.length === group.events.length ? [group] : [{ ...group, events,
      startTime: events[0].timestamp, endTime: events[events.length - 1].timestamp }];
  });
}

/** A new action retires the previous text stream's writing indicator. */
export function isAssistantReplyStreaming(events: RunEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.metadata?.isFromSubagent || event.metadata?.parentToolCallId) continue;
    if (event.type === "tool_call") return false;
    if (event.type !== "artifact") continue;
    if (event.metadata?.kind === "user-prompt" || event.metadata?.kind === "thinking") return false;
    if (event.metadata?.source === "codex_async_questions") return false;
    if (event.metadata?.kind === "report" && event.content.trim()) return event.metadata.streaming === true;
  }
  return false;
}
