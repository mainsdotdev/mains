import { eq } from "drizzle-orm";
import { toolCalls } from "../../db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createRun, createRunArtifact, createRunTurn, createToolCall } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type { RunHistoryCursor } from "@mains/contracts/runs";

let db: DatabaseInstance;
let cleanup: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
import { runsRepo } from "./runs.repo";
import { historyEndAfter } from "@mains/contracts/run-history";
import { validateHistoryRequest } from "./run-history";

const at = (index: number, offset = 0) => new Date(1700000000000 + index * 10000 + offset);
function turn(index: number, runId = "r") {
  createRunTurn(db, { runId, turnIndex: index, startedAt: at(index), createdAt: at(index), status: "completed" });
  const prompt = createRunArtifact(db, { runId, kind: "user-prompt" as "report", content: `prompt-${index}`, createdAt: at(index) });
  createRunArtifact(db, { runId, kind: "report", content: `reply-${index}`, createdAt: at(index, 1000) });
  createToolCall(db, { runId, createdAt: at(index, 2000), updatedAt: at(index, 3000), toolName: `tool-${index}` });
  return prompt;
}
const prompts = (page: ReturnType<typeof runsRepo.findHistoryPage>) => page.artifacts.filter((a) => (a.kind as string) === "user-prompt").map((a) => a.content);

describe("conversation history pages", () => {
  beforeEach(() => { ({ db, cleanup } = createTestDb()); createRun(db, { id: "r" }); });
  afterEach(() => cleanup());

  it("defers large UI outputs without truncating storage, mobile history or another run's data", () => {
    const output = { stdout: "x".repeat(100_000) };
    const call = createToolCall(db, { runId: "r", toolName: "Bash", status: "done", output: JSON.stringify(output) });
    const page = runsRepo.findHistoryPage({ runId: "r", deferToolOutput: true });
    expect(page.toolCalls[0].output).toMatchObject({ type: "mains/deferred-tool-output", chars: JSON.stringify(output).length });
    expect(JSON.stringify(page.toolCalls[0].output).length).toBeLessThan(2500);
    expect(runsRepo.findHistoryPage({ runId: "r" }).toolCalls[0].output).toEqual(output);
    expect(runsRepo.findToolOutput("r", call.id)).toEqual({ output });
    expect(runsRepo.findToolOutput("other-run", call.id)).toBeNull();
  });

  it("opens on 10 complete prompt blocks and keeps unrelated runs out", () => {
    for (let i = 0; i < 45; i++) turn(i);
    turn(100, "another");
    const page = runsRepo.findHistoryPage({ runId: "r" });
    expect(prompts(page)).toEqual(Array.from({ length: 10 }, (_, i) => `prompt-${i + 35}`));
    expect(page.artifacts).toHaveLength(20);
    expect(page.toolCalls).toHaveLength(10);
    expect(page.turns.map((t) => t.turnIndex)).toEqual(Array.from({ length: 10 }, (_, i) => i + 35));
    expect(page.hasOlder).toBe(true);
    expect(page.hasNewer).toBe(false);
  });

  it("pages to the beginning and back with a 30-block bounded window", () => {
    for (let i = 0; i < 65; i++) turn(i);
    let page = runsRepo.findHistoryPage({ runId: "r" });
    const seen = new Set(prompts(page));
    while (page.hasOlder) {
      page = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: page.start! });
      expect(prompts(page).length).toBeLessThanOrEqual(30);
      expect(new Set(page.artifacts.map((a) => a.id)).size).toBe(page.artifacts.length);
      prompts(page).forEach((prompt) => seen.add(prompt));
    }
    expect(seen.size).toBe(65);
    expect(prompts(page)[0]).toBe("prompt-0");
    while (page.hasNewer) page = runsRepo.findHistoryPage({ runId: "r", direction: "newer", cursor: page.end! });
    expect(prompts(page).at(-1)).toBe("prompt-64");
    expect(prompts(page)).toHaveLength(30);
  });

  it("refreshes changed tools in an older window without pulling in new turns", () => {
    for (let i = 0; i < 65; i++) turn(i);
    const latest = runsRepo.findHistoryPage({ runId: "r" });
    const old = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: latest.start! });
    const middle = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: old.start! });
    const older = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: middle.start! });
    turn(65);
    const call = older.toolCalls[0];
    db.update(toolCalls).set({ output: JSON.stringify("updated") }).where(eq(toolCalls.id, call.id)).run();
    const refreshed = runsRepo.findHistoryPage({ runId: "r", direction: "refresh", cursor: older.start!, end: older.end });
    expect(prompts(refreshed)).toEqual(prompts(older));
    expect(refreshed.toolCalls.find((t) => t.id === call.id)?.output).toBe("updated");
    expect(refreshed.hasNewer).toBe(true);
  });

  it("freezes a reading window even when new tools share the last second", () => {
    for (let i = 0; i < 20; i++) turn(i);
    const page = runsRepo.findHistoryPage({ runId: "r" });
    const late = createToolCall(db, { runId: "r", toolName: "late", createdAt: at(19, 2000) });
    const frozen = runsRepo.findHistoryPage({ runId: "r", direction: "refresh", cursor: page.start!, end: historyEndAfter(page.last!) });
    expect(frozen.toolCalls.map((c) => c.id)).not.toContain(late.id);
    expect(frozen.hasNewer).toBe(true);
  });

  it("uses ids to navigate prompts tied at the same timestamp", () => {
    for (let i = 0; i < 42; i++) createRunArtifact(db, { runId: "r", kind: "user-prompt" as "report", content: `prompt-${i}`, createdAt: at(0) });
    let page = runsRepo.findHistoryPage({ runId: "r" });
    const seen = new Set(prompts(page));
    while (page.hasOlder) {
      page = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: page.start! });
      prompts(page).forEach((p) => seen.add(p));
    }
    expect(seen.size).toBe(42);
  });

  it("uses the displayed start time of a voice prompt persisted much later", () => {
    for (let i = 0; i < 20; i++) turn(i);
    const voice = createRunArtifact(db, { runId: "r", kind: "user-prompt" as "report", content: "spoken", createdAt: at(100),
      metadata: JSON.stringify({ voice: true, voiceStartedAt: at(0, 4000).getTime() }) });
    const latest = runsRepo.findHistoryPage({ runId: "r" });
    expect(latest.artifacts.map((a) => a.id)).not.toContain(voice.id);
    const old = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: latest.start! });
    expect(old.artifacts.map((a) => a.id)).toContain(voice.id);
  });

  it("bounds log-only histories and handles empty conversations", () => {
    expect(runsRepo.findHistoryPage({ runId: "r" }).start).toBeNull();
    for (let i = 0; i < 900; i++) createRunArtifact(db, { runId: "r", kind: "log", content: `log-${i}`, createdAt: at(i) });
    const page = runsRepo.findHistoryPage({ runId: "r" });
    expect(page.artifacts).toHaveLength(200);
    expect(page.hasOlder).toBe(true);
    const older = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: page.start! });
    expect(older.artifacts.length).toBeLessThanOrEqual(600);
  });

  it("validates navigation inputs before querying", () => {
    expect(() => validateHistoryRequest({ runId: "r", direction: "older" })).toThrow("cursor is required");
    const cursor: RunHistoryCursor = { timestamp: 1, source: "tool", id: 1 };
    expect(() => validateHistoryRequest({ runId: "r", cursor: { ...cursor, id: NaN } })).toThrow("Invalid history cursor");
    expect(() => validateHistoryRequest({ runId: "r", cursor, end: { ...cursor, timestamp: 0 } })).toThrow("Invalid history window");
  });
});
