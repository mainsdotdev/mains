import { eq } from "drizzle-orm";
import { runTurnChanges, toolCalls } from "../../db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createRun, createRunArtifact, createRunTurn, createToolCall } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import type { ReadRunHistoryPayload, RunHistoryContentPage, RunHistoryCursor } from "@mains/contracts/runs";

let db: DatabaseInstance;
let cleanup: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
import { runsRepo } from "./runs.repo";
import { historyEndAfter } from "@mains/contracts/run-history";
import { validateHistoryContentRequest, validateHistoryRequest } from "./run-history";

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

  it("bounds a phone page even when one prompt produces hundreds of large tool results", () => {
    createRunArtifact(db, { runId: "r", kind: "user-prompt" as "report", content: "one long-running prompt", createdAt: at(0) });
    const output = JSON.stringify({ stdout: "x".repeat(128 * 1024) });
    for (let i = 0; i < 300; i++) createToolCall(db, {
      runId: "r", toolName: "mcp__large_result", status: "done", output,
      createdAt: at(i, 1000), updatedAt: at(i, 2000),
    });
    const request = { runId: "r", profile: "mobile" } as ReadRunHistoryPayload;
    const page = runsRepo.findHistoryPage(request);
    const bytes = Buffer.byteLength(JSON.stringify(page));
    console.info(`Phone history stress: ${page.toolCalls.length} tools, ${bytes} bytes`);
    expect(page.artifacts.length + page.toolCalls.length).toBeLessThanOrEqual(200);
    expect(bytes).toBeLessThanOrEqual(1024 * 1024);
    expect(page.hasOlder).toBe(true);
    expect(runsRepo.findToolOutput("r", page.toolCalls[0].id)?.output).toEqual(JSON.parse(output));
  });

  it("lets a phone traverse a tool-heavy prompt in both directions without gaps", () => {
    const prompt = createRunArtifact(db, { runId: "r", kind: "user-prompt" as "report", content: "prompt", createdAt: at(0) });
    const ids = new Set<string>([`artifact:${prompt.id}`]);
    for (let i = 0; i < 425; i++) {
      const call = createToolCall(db, { runId: "r", createdAt: at(0, 1000) });
      ids.add(`tool:${call.id}`);
    }
    let page = runsRepo.findHistoryPage({ runId: "r", profile: "mobile" });
    const seen = new Set(page.toolCalls.map((call) => `tool:${call.id}`));
    for (let i = 0; page.hasOlder && i < 5; i++) {
      page = runsRepo.findHistoryPage({ runId: "r", profile: "mobile", direction: "older", cursor: page.start! });
      page.artifacts.forEach((row) => seen.add(`artifact:${row.id}`));
      page.toolCalls.forEach((row) => seen.add(`tool:${row.id}`));
    }
    expect(page.hasOlder).toBe(false);
    expect(seen).toEqual(ids);
    for (let i = 0; page.hasNewer && i < 5; i++) {
      page = runsRepo.findHistoryPage({ runId: "r", profile: "mobile", direction: "newer", cursor: page.end! });
    }
    expect(page.hasNewer).toBe(false);
    expect(page.toolCalls.at(-1)?.id).toBe(Number([...ids].at(-1)?.split(":")[1]));
  });

  it("bounds escaped Unicode bytes, excludes blobs and duplicate turn bodies, and leaves full text readable in chunks", () => {
    const text = "😀\u0001".repeat(30_000);
    const artifact = createRunArtifact(db, { runId: "r", kind: "report", content: text, blobData: Buffer.alloc(1024 * 1024), createdAt: at(0) });
    createRunTurn(db, { runId: "r", promptContent: text, responseContent: text, startedAt: at(0), createdAt: at(0) });
    for (let i = 0; i < 150; i++) createToolCall(db, { runId: "r", createdAt: at(i, 1000), output: JSON.stringify("\u0001".repeat(8000)) });
    const page = runsRepo.findHistoryPage({ runId: "r", profile: "mobile" });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024 * 1024);
    expect(page.turns).toHaveLength(1);
    expect(page.turns[0]).toMatchObject({ promptContent: null, responseContent: null });
    let oldest = page;
    while (oldest.hasOlder) oldest = runsRepo.findHistoryPage({ runId: "r", profile: "mobile", direction: "older", cursor: oldest.start! });
    const preview = oldest.artifacts.find((row) => row.id === artifact.id)!;
    expect(preview.blobData).toBeNull();
    expect(preview.metadata?.mobileContentDeferred).toEqual({ chars: 60_000 });
    let restored = "", offset: number | null = 0;
    while (offset !== null) {
      const chunk: RunHistoryContentPage = runsRepo.findHistoryContent({ runId: "r", source: "artifact", id: artifact.id, offset })!;
      expect(Array.from(chunk.text)).toHaveLength(Math.min(8192, 60_000 - offset));
      restored += chunk.text;
      offset = chunk.nextOffset;
    }
    expect(restored).toBe(text);
    expect(runsRepo.findHistoryContent({ runId: "other", source: "artifact", id: artifact.id })).toBeNull();
  });

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

  it("opens on 20 complete prompt blocks and keeps unrelated runs out", () => {
    for (let i = 0; i < 45; i++) turn(i);
    turn(100, "another");
    const page = runsRepo.findHistoryPage({ runId: "r" });
    expect(prompts(page)).toEqual(Array.from({ length: 20 }, (_, i) => `prompt-${i + 25}`));
    expect(page.artifacts).toHaveLength(40);
    expect(page.toolCalls).toHaveLength(20);
    expect(page.turns.map((t) => t.turnIndex)).toEqual(Array.from({ length: 20 }, (_, i) => i + 25));
    expect(page.hasOlder).toBe(true);
    expect(page.hasNewer).toBe(false);
  });

  it("pages to the beginning and back with a 60-block bounded window", () => {
    for (let i = 0; i < 65; i++) turn(i);
    let page = runsRepo.findHistoryPage({ runId: "r" });
    const seen = new Set(prompts(page));
    while (page.hasOlder) {
      page = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: page.start! });
      expect(prompts(page).length).toBeLessThanOrEqual(60);
      expect(new Set(page.artifacts.map((a) => a.id)).size).toBe(page.artifacts.length);
      prompts(page).forEach((prompt) => seen.add(prompt));
    }
    expect(seen.size).toBe(65);
    expect(prompts(page)[0]).toBe("prompt-0");
    while (page.hasNewer) page = runsRepo.findHistoryPage({ runId: "r", direction: "newer", cursor: page.end! });
    expect(prompts(page).at(-1)).toBe("prompt-64");
    expect(prompts(page)).toHaveLength(60);
  });

  it("keeps all tool calls in a prompt block", () => {
    createRunArtifact(db, { runId: "r", kind: "user-prompt" as "report", content: "prompt", createdAt: at(0) });
    for (let i = 0; i < 60; i++) createToolCall(db, { runId: "r", createdAt: at(i, 1000), toolName: `tool-${i}` });
    const page = runsRepo.findHistoryPage({ runId: "r" });
    expect(prompts(page)).toEqual(["prompt"]);
    expect(page.toolCalls).toHaveLength(60);
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
    for (let i = 0; i < 40; i++) turn(i);
    const voice = createRunArtifact(db, { runId: "r", kind: "user-prompt" as "report", content: "spoken", createdAt: at(100),
      metadata: JSON.stringify({ voice: true, voiceStartedAt: at(0, 4000).getTime() }) });
    const latest = runsRepo.findHistoryPage({ runId: "r" });
    expect(latest.artifacts.map((a) => a.id)).not.toContain(voice.id);
    const old = runsRepo.findHistoryPage({ runId: "r", direction: "older", cursor: latest.start! });
    expect(old.artifacts.map((a) => a.id)).toContain(voice.id);
  });

  it("loads complete promptless histories and handles empty conversations", () => {
    expect(runsRepo.findHistoryPage({ runId: "r" }).start).toBeNull();
    for (let i = 0; i < 900; i++) createRunArtifact(db, { runId: "r", kind: "log", content: `log-${i}`, createdAt: at(i) });
    const page = runsRepo.findHistoryPage({ runId: "r" });
    expect(page.artifacts).toHaveLength(900);
    expect(page.hasOlder).toBe(false);
    expect(page.hasNewer).toBe(false);
  });

  it("validates navigation inputs before querying", () => {
    expect(() => validateHistoryRequest({ runId: "r", direction: "older" })).toThrow("cursor is required");
    const cursor: RunHistoryCursor = { timestamp: 1, source: "tool", id: 1 };
    expect(() => validateHistoryRequest({ runId: "r", cursor: { ...cursor, id: NaN } })).toThrow("Invalid history cursor");
    expect(() => validateHistoryRequest({ runId: "r", cursor, end: { ...cursor, timestamp: 0 } })).toThrow("Invalid history window");
    expect(() => validateHistoryContentRequest({ runId: "r", source: "artifact", id: 1, offset: -1 })).toThrow("Invalid conversation content");
  });

  it("sends the active plan and visible turn summaries without bodies or stored patches", () => {
    const files = [{ path: "src/app.ts", status: "modified", additions: 3, deletions: 1, binary: false }];
    const first = createRunTurn(db, { runId: "r", turnIndex: 0, status: "completed", startedAt: at(0), endedAt: at(1), createdAt: at(0) });
    const plan = { providerTurnId: "native-turn", steps: [{ step: "Verify the change", status: "in_progress" }] };
    const active = createRunTurn(db, { runId: "r", turnIndex: 1, status: "active", startedAt: at(2), createdAt: at(2), metadata: JSON.stringify({ codexPlan: plan, internal: "private" }) });
    for (const item of [first, active]) createRunArtifact(db, { runId: "r", kind: "report", content: "reply", createdAt: item.startedAt!, metadata: JSON.stringify({ turnId: item.id }) });
    db.insert(runTurnChanges).values({ id: "changes", runId: "r", turnId: first.id, filesJson: JSON.stringify(files), additions: 3, deletions: 1, diffText: "patch".repeat(100_000) }).run();
    const page = runsRepo.findHistoryPage({ runId: "r", profile: "mobile" });
    expect(page.turns).toHaveLength(2);
    expect(page.turns[0].changes).toMatchObject({ files, additions: 3, deletions: 1, fileCount: 1 });
    expect(page.turns[1].metadata).toEqual({ codexPlan: plan });
    expect(page.turns.every((item) => item.promptContent === null && item.responseContent === null)).toBe(true);
    expect(JSON.stringify(page)).not.toContain("patchpatch");
  });

  it("reads a stored turn patch in bounded Unicode chunks and checks the owning run", () => {
    const item = createRunTurn(db, { runId: "r" });
    const diffText = "diff --git a/file b/file\n" + "😀+new line\n".repeat(3000);
    db.insert(runTurnChanges).values({ id: "changes", runId: "r", turnId: item.id, filesJson: "[]", diffText }).run();
    let restored = "", offset: number | null = 0;
    while (offset !== null) {
      const page: RunHistoryContentPage = runsRepo.findHistoryContent({ runId: "r", source: "turn-diff", id: item.id, offset })!;
      expect(Array.from(page.text).length).toBeLessThanOrEqual(8192);
      restored += page.text;
      offset = page.nextOffset;
    }
    expect(restored).toBe(diffText);
    expect(runsRepo.findHistoryContent({ runId: "another-run", source: "turn-diff", id: item.id })).toBeNull();
    expect(() => validateHistoryContentRequest({ runId: "r", source: "turn-diff", id: item.id, offset: -1 })).toThrow();
  });

  it("budgets turn summaries together with rows and keeps oversized file counts accurate", () => {
    const largeFiles = Array.from({ length: 400 }, (_, i) => ({ path: `file-${i}`, status: "modified", additions: 1, deletions: 0, binary: false }));
    const plan = { providerTurnId: "native", steps: [{ step: "\u0001".repeat(2000), status: "pending" }] };
    for (let i = 0; i < 120; i++) {
      const item = createRunTurn(db, { runId: "r", turnIndex: i, startedAt: at(i), createdAt: at(i), metadata: JSON.stringify({ codexPlan: plan }) });
      createRunArtifact(db, { runId: "r", kind: "report", content: "\u0001".repeat(2000), createdAt: at(i), metadata: JSON.stringify({ turnId: item.id }) });
      db.insert(runTurnChanges).values({ id: `changes-${i}`, runId: "r", turnId: item.id, filesJson: JSON.stringify(largeFiles), diffText: "huge".repeat(100_000) }).run();
    }
    let page = runsRepo.findHistoryPage({ runId: "r", profile: "mobile" });
    const seen = new Set(page.artifacts.map((row) => row.id));
    for (let i = 0; i < 10; i++) {
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024 * 1024);
      expect(page.turns.at(-1)?.changes).toMatchObject({ files: [], fileCount: 400 });
      for (const artifact of page.artifacts) expect(page.turns.some((item) => item.id === artifact.metadata?.turnId)).toBe(true);
      if (!page.hasOlder) break;
      page = runsRepo.findHistoryPage({ runId: "r", profile: "mobile", direction: "older", cursor: page.start! });
      page.artifacts.forEach((row) => seen.add(row.id));
    }
    expect(seen.size).toBe(120);
  });
});
