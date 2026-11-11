import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/setup-db";
import { createAccount, createProvider, createRun, createToolCall } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";
import { createRunWriteback } from "./runWriteback";
import { runsService } from "../../modules/runs";
import { toolsService } from "../../modules/tools";

let db: DatabaseInstance;
let cleanup: () => void;
vi.mock("../../db/client", () => ({ getDb: () => db }));
const CONFIG = { accountId: "default", providerId: "copilot_cli", runId: "writeback-run" };
beforeEach(() => {
  ({ db, cleanup } = createTestDb());
  createAccount(db, { id: CONFIG.accountId });
  createProvider(db, { id: CONFIG.providerId });
  createRun(db, { id: CONFIG.runId, accountId: CONFIG.accountId, providerId: CONFIG.providerId });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const calls = () => toolsService.getToolCallsByRun(CONFIG.runId);

describe("run writeback through shared projection rules", () => {
  it("settles tools and saves other reports when one recovery write fails", async () => {
    const writer = createRunWriteback(CONFIG);
    await writer.handleEvent({ type: "tool_call", toolName: "Bash", metadata: { phase: "start", toolCallId: "failed-recovery" } });
    for (const streamId of ["first-report", "second-report"]) await writer.handleEvent({ type: "artifact", kind: "report", ephemeral: true, streamId, content: streamId });
    const insert = vi.spyOn(runsService, "addArtifact").mockRejectedValueOnce(new Error("Database busy"));
    try {
      await expect(writer.finish("canceled")).rejects.toThrow("Database busy");
      expect((await calls())[0].status).toBe("error");
      expect((await runsService.getArtifactsByRun(CONFIG.runId)).map((artifact) => artifact.content)).toEqual(["second-report"]);
    } finally { insert.mockRestore(); }
  });
  it("drains admitted writes and settles tools, background work and partial text before closing", async () => {
    const writer = createRunWriteback(CONFIG);
    const start = writer.handleEvent({ type: "tool_call", toolName: "Agent", metadata: { phase: "start", toolCallId: "closing-agent" } });
    const task = writer.handleEvent({ type: "task", toolCallId: "closing-agent", taskId: "agent", phase: "started", status: "running" });
    await writer.handleEvent({ type: "artifact", kind: "report", ephemeral: true, streamId: "unfinished", content: "Keep this answer" });
    await writer.finish("canceled"); await Promise.all([start, task]);
    expect(await calls()).toEqual([expect.objectContaining({ status: "error", metadata: expect.objectContaining({ task: expect.objectContaining({ status: "stopped" }) }) })]);
    expect(await runsService.getArtifactsByRun(CONFIG.runId)).toEqual([expect.objectContaining({ content: "Keep this answer", metadata: expect.objectContaining({ interrupted: true, streaming: false }) })]);
    await writer.handleEvent({ type: "log", message: "Too late" });
    await writer.finish("succeeded");
    expect(await runsService.getArtifactsByRun(CONFIG.runId)).toHaveLength(1);
  });
  it("never stores transient snapshots as durable transcript rows", async () => {
    const writer = createRunWriteback(CONFIG);
    await writer.handleEvent({ type: "artifact", kind: "report", ephemeral: true, streamId: "live-only", content: "Partial" });
    expect(await runsService.getArtifactsByRun(CONFIG.runId)).toEqual([]);
  });
  it("starts empty and persists log and artifact content through the public services", async () => {
    const writer = createRunWriteback(CONFIG);
    expect(writer.getPendingToolCallCount()).toBe(0);
    await writer.handleEvent({ type: "log", level: "warn", message: "Warning", ts: 123 });
    await writer.handleEvent({ type: "artifact", kind: "report", content: "const x = 1;" });
    const artifacts = await runsService.getArtifactsByRun(CONFIG.runId);
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log", content: "Warning", metadata: expect.objectContaining({ level: "warn", ts: 123 }) }),
      expect.objectContaining({ kind: "report", content: "const x = 1;", contentHash: expect.any(String) }),
    ]));
  });
  it.each(["toolCallId", "tool_call_id", "id"])("correlates %s without creating duplicate rows", async (field) => {
    const writer = createRunWriteback(CONFIG);
    const start = { type: "tool_call" as const, toolName: "Read", startedAt: 1000,
      metadata: { phase: "start", [field]: "stable-call", parentToolCallId: "parent" } };
    await Promise.all([writer.handleEvent(start), writer.handleEvent(start), writer.handleEvent({
      ...start, endedAt: 2000, output: { content: "result" }, metadata: { ...start.metadata, phase: "end" },
    })]);
    expect(await calls()).toEqual([expect.objectContaining({ toolCallId: "stable-call", parentToolCallId: "parent",
      status: "done", output: { content: "result" }, latencyMs: 1000 })]);
    expect(writer.getPendingToolCallCount()).toBe(0);
  });
  it("never closes a same-named sibling when a different stable id completes", async () => {
    const writer = createRunWriteback(CONFIG);
    await writer.handleEvent({ type: "tool_call", toolName: "Read", metadata: { phase: "start", toolCallId: "live" } });
    await writer.handleEvent({ type: "tool_call", toolName: "Read", output: { content: "orphan" }, metadata: { phase: "end", toolCallId: "other" } });
    const rows = await calls();
    expect(rows.find((row) => row.toolCallId === "live")?.status).toBe("running");
    expect(rows.find((row) => row.toolCallId === "other")).toMatchObject({ status: "done", output: { content: "orphan" } });
    expect(writer.getPendingToolCallCount()).toBe(1);
  });
  it("hydrates an existing open call and resolves it by exact identity", async () => {
    createToolCall(db, { runId: CONFIG.runId, toolCallId: "restored", toolName: "Bash", status: "running" });
    const writer = createRunWriteback(CONFIG);
    await writer.handleEvent({ type: "tool_call", toolName: "Bash", metadata: { phase: "end", toolCallId: "restored" }, output: { stdout: "ok" } });
    expect(await calls()).toEqual([expect.objectContaining({ toolCallId: "restored", status: "done", output: { stdout: "ok" } })]);
    expect(writer.getPendingToolCallCount()).toBe(0);
  });
  it("matches the oldest legacy call by name when no stable id exists", async () => {
    const writer = createRunWriteback(CONFIG);
    await writer.handleEvent({ type: "tool_call", toolName: "Grep", startedAt: 5000, metadata: { phase: "start" } });
    await writer.handleEvent({ type: "tool_call", toolName: "Grep", startedAt: 6000, metadata: { phase: "end" }, output: { matches: 2 } });
    expect(await calls()).toEqual([expect.objectContaining({ status: "done", output: { matches: 2 } })]);
    expect(writer.getPendingToolCallCount()).toBe(0);
  });
  it.each(["done", "error", "canceled"] as const)("persists a complete record with terminal status %s", async (terminalStatus) => {
    const writer = createRunWriteback(CONFIG);
    await writer.handleEvent({ type: "tool_call", toolName: "Bash", terminalStatus, output: { stdout: "output" },
      ...(terminalStatus === "error" ? { error: "Failed" } : {}), metadata: { toolCallId: "complete" } });
    expect(await calls()).toEqual([expect.objectContaining({ status: terminalStatus, output: { stdout: "output" } })]);
  });
  it("keeps a definitive completion when the provider repeats the same result", async () => {
    const writer = createRunWriteback(CONFIG);
    const event = { type: "tool_call" as const, toolName: "Read", output: { content: "one" }, metadata: { phase: "end", toolCallId: "once" } };
    await writer.handleEvent(event); await writer.handleEvent(event);
    expect(await calls()).toHaveLength(1);
  });
  it("logs a failed write without preventing later event processing", async () => {
    const writer = createRunWriteback(CONFIG);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.spyOn(runsService, "addArtifact").mockRejectedValueOnce(new Error("Database busy"));
    await writer.handleEvent({ type: "log", message: "rejected" });
    await writer.handleEvent({ type: "log", message: "saved" });
    expect(log).toHaveBeenCalled();
    expect((await runsService.getArtifactsByRun(CONFIG.runId)).map((artifact) => artifact.content)).toEqual(["saved"]);
    write.mockRestore();
  });
  it("does not turn provider status events into a second run status owner", async () => {
    const writer = createRunWriteback(CONFIG);
    await writer.handleEvent({ type: "status", status: "failed" });
    expect((await runsService.getRunById(CONFIG.runId))?.status).toBe("queued");
  });
});
