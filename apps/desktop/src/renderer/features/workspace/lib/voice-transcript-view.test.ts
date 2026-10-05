import { describe, expect, it } from "vitest";
import type { RunTurn } from "@/lib/redux/api";
import type { RunEvent } from "../types";
import { annotateVoiceWorkEvents, projectVoiceTranscriptEvents } from "./voice-transcript-view";

const scope = { inputSource: "voice", realtimeSessionId: "call", providerTurnId: "native" };
const turn: RunTurn = {
  id: 1, runId: "run", turnIndex: 0, metadata: scope, status: "completed", startedAt: 10_000, endedAt: 30_000,
  promptContent: null, responseContent: null, elapsedMs: 20_000, createdAt: 10_000,
  inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
  costMicros: null, model: null, modelUsage: null,
};
function event(id: string, time: number, metadata: Record<string, unknown> = {}): RunEvent {
  return { id, type: "artifact", content: id, timestamp: new Date(time), metadata: { kind: "report", ...metadata } };
}

describe("voice work provenance", () => {
  it("keeps voice-only user and assistant replies in permanent history", () => {
    const speech = [event("user", 10_000, { voice: true, kind: "user-prompt", source: "user" }),
      event("greeting", 12_000, { voice: true, realtimeSessionId: "call" })];
    expect(annotateVoiceWorkEvents(speech, [])).toBe(speech);
  });
  it("marks written work and running tools while keeping speech separate from work provenance", () => {
    const speech = event("spoken", 12_000, { ...scope, voice: true });
    const work = event("written", 13_000, scope);
    const tool = { ...event("tool", 14_000, scope), type: "tool_call" as const };
    const projected = annotateVoiceWorkEvents([speech, work, tool], [turn]);
    expect(projected[0]).toBe(speech);
    expect(projected[1].metadata?.voiceWorkId).toBe(projected[2].metadata?.voiceWorkId);
    expect(projected[1].metadata?.voiceWorkTurnId).toBe(1);
    expect(work.metadata).not.toHaveProperty("voiceWorkId");
  });
  it("keeps written-origin work in normal chat even when its timing overlaps voice", () => {
    const written = event("normal", 15_000, { inputSource: "text", providerTurnId: "typed" });
    const typedTurn = { ...turn, id: 2, metadata: { inputSource: "text", providerTurnId: "typed" } };
    expect(annotateVoiceWorkEvents([written], [turn, typedTurn])).toEqual([written]);
  });
  it("recovers old unannotated tools only within a uniquely identified native voice turn", () => {
    const legacyTurn = { ...turn, metadata: { providerTurnId: "native" } };
    const speech = event("speech", 12_000, { voice: true, realtimeSessionId: "call", providerTurnId: "native" });
    const tool = { ...event("legacy-tool", 15_000), type: "tool_call" as const };
    expect(annotateVoiceWorkEvents([speech, tool], [legacyTurn])[1].metadata?.voiceWorkTurnId).toBe(1);
    const overlap = { ...turn, id: 2, metadata: { providerTurnId: "typed" } };
    expect(annotateVoiceWorkEvents([speech, tool], [legacyTurn, overlap])[1]).toBe(tool);
  });
  it("does not attach late events with an explicit different native turn by their timestamp", () => {
    const other = event("typed", 15_000, { providerTurnId: "different-native" });
    expect(annotateVoiceWorkEvents([other], [turn])[0]).toBe(other);
  });
  it("keeps a work identity after completion and across later voice calls", () => {
    const work = event("late-work", 40_000, scope);
    const newSpeech = event("new-call", 39_000, { voice: true, realtimeSessionId: "later-call" });
    const projected = annotateVoiceWorkEvents([work, newSpeech], [turn]);
    expect(projected[0].metadata?.voiceWorkTurnId).toBe(1);
    expect(projected[1]).toBe(newSpeech);
  });
});

describe("voice conversation display", () => {
  it("shows spoken replies and ordinary tools instead of the screenshot's written duplicate", () => {
    const written = event("Başlığı ve platforma göre değişen indirme alanını ayrı ...", 12_000, { ...scope, source: "agent_message" });
    const spoken = event("Başlığı ve platforma göre değişen indirme alanını ...", 13_000, { ...scope, voice: true, source: "agent_message" });
    const tool = { ...event("Read", 14_000, scope), type: "tool_call" as const };
    expect(projectVoiceTranscriptEvents([written, spoken, tool], [turn]).map((item) => item.id)).toEqual([spoken.id, tool.id]);
  });

  it("hides live written previews before the turn metadata is loaded", () => {
    const preview = event("written-preview", 12_000, { inputSource: "voice", streaming: true, source: "agent_message_streaming" });
    expect(projectVoiceTranscriptEvents([preview], [])).toEqual([]);
  });

  it("keeps voice-only conversation and every user prompt visible", () => {
    const events = [event("typed-user", 10_000, { kind: "user-prompt" }),
      event("spoken-user", 11_000, { voice: true, kind: "user-prompt" }),
      event("spoken-answer", 12_000, { voice: true })];
    expect(projectVoiceTranscriptEvents(events, [])).toBe(events);
  });

  it("keeps tools, errors, plans, apps and generated files in the regular timeline", () => {
    const events = [event("written", 11_000, scope),
      { ...event("tool", 12_000, scope), type: "tool_call" as const },
      { ...event("error", 13_000, scope), type: "log" as const, metadata: { ...scope, level: "error" } },
      event("document", 14_000, { ...scope, kind: "document" }),
      event("image", 15_000, { ...scope, kind: "image" }),
      { ...event("plan", 16_000, scope), type: "tool_call" as const, content: "Plan: next steps" },
      { ...event("app", 17_000, { ...scope, mcpApp: {} }), type: "tool_call" as const }];
    expect(projectVoiceTranscriptEvents(events, [turn]).map((item) => item.id)).toEqual(events.slice(1).map((item) => item.id));
  });

  it("keeps completed voice work hidden while a subsequent written chat response shows normally", () => {
    const typedTurn = { ...turn, id: 2, startedAt: 40_000, endedAt: 50_000, metadata: { providerTurnId: "typed" } };
    const events = [event("old-written", 12_000, scope), event("old-spoken", 13_000, { ...scope, voice: true }),
      event("typed-user", 41_000, { kind: "user-prompt" }),
      event("typed-reply", 42_000, { source: "agent_message", providerTurnId: "typed" }),
      event("late-voice-work", 45_000, scope)];
    expect(projectVoiceTranscriptEvents(events, [turn, typedTurn]).map((item) => item.id)).toEqual(["old-spoken", "typed-user", "typed-reply"]);
  });

  it("recognizes legacy native voice turns without rewriting saved history", () => {
    const legacyTurn = { ...turn, metadata: { providerTurnId: "native" } };
    const events = [event("old-written", 12_000),
      event("old-spoken", 13_000, { voice: true, realtimeSessionId: "call", providerTurnId: "native" })];
    expect(projectVoiceTranscriptEvents(events, [legacyTurn]).map((item) => item.id)).toEqual(["old-spoken"]);
    expect(events[0].metadata).not.toHaveProperty("voiceWorkId");
  });

  it("leaves unproven and explicit text messages visible, even when timing overlaps voice", () => {
    const events = [event("typed", 12_000, { inputSource: "text" }),
      event("unknown-native", 13_000, { providerTurnId: "unknown" })];
    expect(projectVoiceTranscriptEvents(events, [turn])).toBe(events);
  });
});
