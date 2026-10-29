import assert from "node:assert/strict";
import test from "node:test";
import { turnRow } from "../src/backend/turn-projection.ts";
import { activeRunPlan, readRunTurns, readTurnChanges, turnChangeFooters } from "../src/features/runs/lib/run-progress.ts";
import { buildTranscript } from "../src/lib/transcript.ts";
import { buildTurnRows } from "../src/lib/transcript-rows.ts";
import { historyEntryTurn } from "@mains/contracts/run-progress";

const at = (value) => new Date(value * 1000);
const changes = { id: "changes", files: [{ path: "app.ts", status: "modified", additions: 5, deletions: 2, binary: false }], additions: 5, deletions: 2, truncated: false, undoneAt: null };
const plan = { providerTurnId: "native", steps: [{ step: "Inspect", status: "completed" }, { step: "Verify", status: "in_progress" }] };
const turn = (index = 0, overrides = {}) => ({ id: index + 1, runId: "r", turnIndex: index, promptContent: "full prompt", responseContent: "full response", status: "completed", startedAt: at(index * 10), endedAt: at(index * 10 + 5), createdAt: at(index * 10), elapsedMs: 5000, model: "model", metadata: null, changes: null, ...overrides });
const call = (id, toolName, input, overrides = {}) => ({ backendId: "b", runId: "r", id, toolName, inputJson: JSON.stringify(input), outputJson: null, metadataJson: JSON.stringify({ turnId: 1 }), toolId: null, parentToolCallId: null, status: "done", error: null, startedAt: at(1), endedAt: at(2), createdAt: at(id), updatedAt: at(id), ...overrides });
const item = (key, kind, time, turnId) => ({ key, kind, at: time * 1000, turnId, text: key, skills: [], files: [], images: [] });

test("a synced turn retains progress and file summaries without duplicate bodies or unrelated metadata", () => {
  const row = turnRow("b", turn(0, { metadata: { codexPlan: plan, private: "excluded" }, changes: { ...changes, undoneAt: at(20) } }));
  assert.equal(row.promptContent, null);
  assert.equal(row.responseContent, null);
  assert.deepEqual(JSON.parse(row.metadataJson), { codexPlan: plan });
  const [restored] = readRunTurns([row]);
  assert.deepEqual(restored.metadata.codexPlan, plan);
  assert.equal(restored.changes.undoneAt.getTime(), at(20).getTime());
  assert.equal(restored.changes.files[0].path, "app.ts");
});

test("ISO dates from a demo or older backend become SQLite dates before projection", () => {
  const row = turnRow("b", turn(0, { startedAt: at(1).toISOString(), endedAt: at(5).toISOString(), createdAt: at(0).toISOString() }));
  assert.equal(row.startedAt.getTime(), at(1).getTime());
  assert.equal(row.endedAt.getTime(), at(5).getTime());
  assert.equal(row.createdAt.getTime(), at(0).getTime());
});

test("structural progress wins over legacy tool lists and disappears when completed", () => {
  const active = turn(0, { status: "active", metadata: { codexPlan: plan } });
  const calls = [call(1, "TodoWrite", { todos: [{ content: "Older checklist", status: "pending" }] })];
  assert.deepEqual(activeRunPlan([active], calls), plan);
  assert.equal(activeRunPlan([{ ...active, metadata: { codexPlan: { ...plan, steps: plan.steps.map((step) => ({ ...step, status: "completed" })) } } }], calls), null);
  assert.equal(activeRunPlan([{ ...active, status: "completed" }], calls), null);
});

test("a new turn never inherits its predecessor's checklist or a child agent's tasks", () => {
  const old = turn(0, { metadata: { codexPlan: plan } });
  const active = turn(1, { status: "active" });
  const calls = [call(1, "TodoWrite", { todos: [{ content: "Old work", status: "pending" }] }),
    call(12, "TaskCreate", { subject: "Child work" }, { parentToolCallId: "agent", metadataJson: '{"turnId":2}' })];
  assert.equal(activeRunPlan([old, active], calls), null);
});

test("legacy TaskCreate and TaskUpdate calls update the current turn's checklist", () => {
  const active = turn(0, { status: "active" });
  const calls = [call(1, "TaskCreate", { subject: "Inspect" }), call(2, "TaskCreate", { subject: "Verify" }), call(3, "TaskUpdate", { taskId: "1", status: "completed" }), call(4, "TaskUpdate", { taskId: "2", status: "in_progress" })];
  assert.deepEqual(activeRunPlan([active], calls).steps, plan.steps);
  assert.equal(activeRunPlan([active], [...calls, call(5, "TaskUpdate", { taskId: "2", status: "completed" })]), null);
});

test("turn changes follow the final answer and stay outside collapsed execution details", () => {
  const rows = buildTurnRows([item("prompt", "prompt", 0, 1), item("comment", "response", 1, 1), item("final", "response", 4, 1)]);
  const footers = turnChangeFooters(rows, [turn(0, { changes })], true);
  assert.equal(rows.at(-1).kind, "accordion");
  assert.deepEqual([...footers.keys()], [rows.at(-1).key]);
  assert.equal(footers.get(rows.at(-1).key)[0].changes.additions, 5);
});

test("steering prompts don't duplicate the current turn's change card", () => {
  const rows = buildTurnRows([item("prompt", "prompt", 0, 1), item("before", "response", 1, 1), item("steer", "prompt", 2, 1), item("after", "response", 4, 1)]);
  const footers = turnChangeFooters(rows, [turn(0, { changes })], true);
  assert.equal(footers.size, 1);
  assert.equal(footers.get(rows.at(-1).key)[0].id, 1);
});

test("turn identities separate timestamp ties and history windows do not show unfinished work as complete", () => {
  const turns = [turn(0, { changes }), turn(1, { startedAt: at(0), changes: { ...changes, id: "second" } })];
  const rows = buildTurnRows([item("first", "response", 0, 1), item("prompt", "prompt", 0, 2), item("second", "response", 0, 2)]);
  const footers = turnChangeFooters(rows, turns, true);
  assert.equal(footers.get(rows[0].key)[0].id, 1);
  assert.equal(footers.get(rows.at(-1).key)[0].id, 2);
  assert.equal(turnChangeFooters(rows, turns, false).size, 0);
  assert.equal(turnChangeFooters(rows, [turn(0, { status: "active", changes })], true).size, 0);
  assert.equal(historyEntryTurn(turns, at(4).getTime()), undefined);
  assert.equal(historyEntryTurn(turns, at(4).getTime(), 99), undefined);
  assert.equal(historyEntryTurn([turn()], at(4).getTime()).id, 1);
});

test("transcript grouping preserves persisted turn identity, including across consecutive tools", () => {
  const calls = [call(1, "Read", {}), call(2, "Read", {}, { metadataJson: '{"turnId":2}' })];
  const artifacts = [{ backendId: "b", runId: "r", id: 3, kind: "report", content: "Final answer", path: null, metadataJson: '{"turnId":2}', createdAt: at(3) }];
  const transcript = buildTranscript(artifacts, calls);
  assert.deepEqual(transcript.map((row) => row.turnId), [1, 2, 2]);
  assert.equal(transcript.filter((row) => row.kind === "tools").length, 2);
});

test("legacy caches and malformed summaries don't create change cards or crash progress", () => {
  const row = { ...turnRow("b", turn()), id: null };
  assert.deepEqual(readRunTurns([row]), []);
  assert.equal(readTurnChanges("invalid"), null);
  assert.equal(readTurnChanges('{"id":"x","files":[],"additions":"bad"}'), null);
  const large = readTurnChanges(JSON.stringify({ ...changes, files: [], fileCount: 400 }));
  assert.equal(large.fileCount, 400);
  assert.equal(large.files.length, 0);
});
