import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { CHANNELS } from "@mains/contracts/channels";

import { createDemoReview, DEMO_REVIEW_RUN_ID, DEMO_REVIEW_TURN_ID, readDemoTurnDiff } from "../src/backend/demo/demo-review.ts";
import { readTurnFileDiff } from "../src/lib/turn-file-diff.ts";

const fixture = () => createDemoReview({ id: "original", model: "demo-model", providerId: "codex", mode: "developer", workspaceId: "sample" }, "2026-10-28T06:00:00.000Z");

// Metro supports the bundled JSON import without Node's import attribute.
registerHooks({ load(url, context, nextLoad) {
  if (url === new URL("../src/backend/demo/demo-snapshot.json", import.meta.url).href) {
    return { format: "module", source: `export default ${readFileSync(new URL(url), "utf8")}`, shortCircuit: true };
  }
  return nextLoad(url, context);
} });

test("the actual demo backend lists the example in the default workspace and serves its stored diff", async () => {
  const { DemoBackend } = await import("../src/backend/demo/demo-backend.ts");
  const backend = new DemoBackend();
  const runs = backend.invoke(CHANNELS.runs.getAll, []);
  assert.equal(runs[0].id, DEMO_REVIEW_RUN_ID);
  const workspaces = backend.invoke(CHANNELS.workspace.list, []);
  assert.equal(workspaces.find((workspace) => workspace.id === runs[0].workspaceId).name, "mains");
  const turns = backend.invoke(CHANNELS.runTurns.getByRun, [runs[0].id]);
  assert.equal(turns[0].id, DEMO_REVIEW_TURN_ID);
  assert.equal(turns[0].changes.files.length, 2);
  const artifacts = backend.invoke(CHANNELS.runArtifacts.getByRun, [runs[0].id]);
  assert.equal(artifacts[1].metadata.turnId, turns[0].id);
  assert.ok(artifacts[1].content.includes("Edited 2 files"));
  const page = await readTurnFileDiff({ path: "src/greeting.ts", read: async (offset) =>
    backend.invoke(CHANNELS.runs.readHistoryContent, [{ source: "turn-diff", runId: runs[0].id, id: DEMO_REVIEW_TURN_ID, offset }]) });
  assert.equal(page.found, true);
  assert.equal(page.diff.added, 1);
  assert.equal(backend.invoke(CHANNELS.runs.listOutputs, [{ runId: runs[0].id }]).items.length, 2);
});

test("the discoverable demo conversation owns its completed turn, attachment and summary", () => {
  const demo = fixture();
  assert.equal(demo.run.title, "Review demo files");
  assert.equal(demo.run.status, "succeeded");
  assert.equal(demo.run.workspaceId, "sample");
  assert.equal(demo.turns[0].status, "completed");
  assert.equal(demo.turns[0].changes.files.length, 2);
  assert.equal(demo.artifacts[0].metadata.attachments[0].name, "demo-report.pdf");
  for (const row of [...demo.turns, ...demo.artifacts]) assert.equal(row.runId, DEMO_REVIEW_RUN_ID);
  assert.equal(demo.artifacts[1].metadata.turnId, demo.turns[0].id);
});

test("each advertised demo file opens in the real bounded diff reader with matching counts", async () => {
  for (const file of fixture().turns[0].changes.files) {
    const page = await readTurnFileDiff({ path: file.path,
      read: async (offset) => readDemoTurnDiff(DEMO_REVIEW_RUN_ID, DEMO_REVIEW_TURN_ID, offset) });
    assert.equal(page.found, true);
    assert.equal(page.binary, false);
    assert.equal(page.next, null);
    assert.equal(page.diff.added, file.additions);
    assert.equal(page.diff.removed, file.deletions);
    const lines = page.diff.hunks.flatMap((hunk) => hunk.lines);
    assert.ok(lines.some((line) => line.type === "add" && line.newNo === 1 + (file.path.endsWith(".ts") ? 1 : 0)));
    assert.ok(lines.every((line) => !line.text.includes("diff --git")));
  }
});

test("demo diffs reject other conversations, turns and invalid Unicode offsets", () => {
  assert.throws(() => readDemoTurnDiff("other-run", DEMO_REVIEW_TURN_ID), /Review demo files/);
  assert.throws(() => readDemoTurnDiff(DEMO_REVIEW_RUN_ID, DEMO_REVIEW_TURN_ID + 1), /Review demo files/);
  for (const offset of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => readDemoTurnDiff(DEMO_REVIEW_RUN_ID, DEMO_REVIEW_TURN_ID, offset), /offset/);
  }
  const first = readDemoTurnDiff(DEMO_REVIEW_RUN_ID, DEMO_REVIEW_TURN_ID);
  assert.deepEqual(readDemoTurnDiff(DEMO_REVIEW_RUN_ID, DEMO_REVIEW_TURN_ID, first.totalChars), {
    text: "", offset: first.totalChars, nextOffset: null, totalChars: first.totalChars,
  });
});

test("each demo session has independent change and attachment metadata", () => {
  const first = fixture(), second = fixture();
  first.turns[0].changes.files[0].path = "changed.ts";
  first.artifacts[0].metadata.attachments[0].name = "changed.pdf";
  assert.equal(second.turns[0].changes.files[0].path, "src/greeting.ts");
  assert.equal(second.artifacts[0].metadata.attachments[0].name, "demo-report.pdf");
});
