import { describe, expect, it } from "vitest";
import { asyncQuestionMessageId } from "@mains/contracts/async-questions";
import type { RunEvent } from "../types";
import { groupEvents } from "./group-events";
import { buildTurnRenderRows } from "./transcript-rows";
import { assistantTranscriptGroups, isAssistantReplyStreaming } from "./assistant-transcript-view";

const event = (id: string, kind: string, extra: Record<string, unknown> = {}): RunEvent => ({
  id, type: "artifact", content: id, timestamp: new Date(Number(id.replace(/\D/g, "")) * 1000 || 1000), metadata: { kind, ...extra },
});
const tool: RunEvent = { ...event("tool1", ""), type: "tool_call", content: "Bash: npm test", metadata: { toolName: "Bash", status: "done" } };
const question: RunEvent = { ...tool, id: "question", content: "AskAssistantQuestion", metadata: {
  toolName: "AskAssistantQuestion", status: "done", input: { question: "Where to?" }, output: { status: "answered", answer: "Tokyo" },
} };
const questionAnswer = { artifactId: 12, answers: ["Tokyo"] };
const clientUserMessageId = asyncQuestionMessageId(questionAnswer.artifactId);
const promptReply = event("answer3", "user-prompt", { asyncQuestionReply: questionAnswer, clientUserMessageId });

describe("assistant conversation projection", () => {
  it("shows both kinds of question in order and coalesces the async answer with its card", () => {
    const prompt = event("prompt1", "user-prompt"), first = event("reply2", "report"), last = event("reply4", "report");
    const asyncQuestion = event("artifact-12", "report", {
      source: "codex_async_questions", questions: [{ title: "Which city?", options: ["Kyoto", "Tokyo"] }],
    });
    const log: RunEvent = { ...tool, id: "log", type: "log", content: "Session initialized", metadata: { level: "info" } };
    const compaction = { ...log, id: "compaction", content: "Context compacted", metadata: { source: "context_compaction", phase: "end" } };
    const events = [prompt, first, tool, question, asyncQuestion, promptReply, log, compaction, last];
    const original = groupEvents(events);
    const groups = assistantTranscriptGroups(original);
    const recoveredQuestion = { ...asyncQuestion, metadata: { ...asyncQuestion.metadata,
      asyncQuestionAnswer: { ...questionAnswer, clientUserMessageId } } };
    expect(groups.flatMap(group => group.events)).toEqual([prompt, first, question, recoveredQuestion, promptReply, last]);
    expect(buildTurnRenderRows(groups, "conversation").flatMap(row => row.kind === "flat" ? row.indices : [])
      .flatMap(index => groups[index].events)).toEqual([prompt, first, question, recoveredQuestion, last]);
    expect(original.some(group => group.type === "tool_calls")).toBe(true);
    expect(original.some(group => group.type === "context_compaction")).toBe(true);
    expect(asyncQuestion.metadata?.asyncQuestionAnswer).toBeUndefined();
  });

  it("keeps a confirmed reply visible when its question is on an earlier history page", () => {
    const groups = assistantTranscriptGroups(groupEvents([promptReply]));
    expect(groups[0].representedByQuestion).toBeUndefined();
    expect(buildTurnRenderRows(groups, "conversation")).toEqual([{ kind: "flat", indices: [0] }]);
  });

  it("keeps deliverables, selected images and interactive apps without showing scratch previews", () => {
    const document = event("doc1", "document", { path: "/tmp/trip.pdf" });
    const scratch = event("scratch2", "image", { path: "/tmp/preview.png", working: true });
    const selected = event("selected3", "image", { path: "/tmp/chosen.png", working: true, outputSelected: true });
    const image = event("image4", "image", { path: "/tmp/generated.png" });
    const chart = event("chart5", "visualization", { path: "/tmp/chart.html" });
    const app: RunEvent = { ...tool, id: "app", content: "mcp__calendar__show_schedule", metadata: { mcpApp: { appName: "Calendar" } } };
    const groups = assistantTranscriptGroups(groupEvents([document, scratch, selected, image, chart, app]));
    expect(groups.flatMap(group => group.events)).toEqual([document, selected, image, chart, app]);
    expect(groups.find(group => group.type === "mcp_app")?.events).toEqual([app]);
  });

  it("keeps errors and warnings visible", () => {
    const error: RunEvent = { ...tool, id: "error", type: "log", content: "Connection lost", metadata: { level: "error" } };
    const warning: RunEvent = { ...error, id: "warn", content: "Sign in to continue", metadata: { level: "warn" } };
    expect(assistantTranscriptGroups(groupEvents([error, warning])).flatMap(group => group.events)).toEqual([error, warning]);
  });

  it("resumes quiet activity after a new tool or thought instead of retaining an earlier text stream", () => {
    const reply = event("reply", "report", { streaming: true });
    const thought = event("thought", "thinking");
    expect(isAssistantReplyStreaming([reply])).toBe(true);
    expect(isAssistantReplyStreaming([reply, tool])).toBe(false);
    expect(isAssistantReplyStreaming([reply, thought])).toBe(false);
    expect(isAssistantReplyStreaming([reply, { ...tool, metadata: { isFromSubagent: true } }])).toBe(true);
  });
});
