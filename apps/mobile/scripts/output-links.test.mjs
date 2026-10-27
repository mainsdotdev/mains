import assert from "node:assert/strict";
import test from "node:test";

import { fileLinkFilter, knownOutputNames } from "../src/lib/output-reference.ts";
import { buildTranscript } from "../src/lib/transcript.ts";

let nextId = 1;
const artifact = (kind, metadata = {}, path = null) => ({
  backendId: "mac",
  runId: "run",
  id: nextId++,
  kind,
  content: "",
  path,
  metadataJson: JSON.stringify(metadata),
  createdAt: new Date(nextId * 1000),
});
const documents = (items) => items.filter((item) => item.kind === "document").map((item) => item.name);

test("only selected outputs become file cards; a replica's working copies stay out", () => {
  const items = buildTranscript([
    artifact("document", { outputSelected: true, fileName: "proposal.docx" }, "/out/proposal.docx"),
    artifact("document", { working: true, fileName: "proposal-draft.docx" }, "/out/proposal-draft.docx"),
    artifact("file", { toolName: "Write" }, "/repo/src/utils.ts"),
    artifact("visualization", { title: "Revenue chart" }),
  ], []);
  assert.deepEqual(documents(items), ["proposal.docx", "Revenue chart"]);
  assert.equal(items.find((item) => item.name === "Revenue chart")?.desktopOnly, true);
});

test("a conversation's known outputs come from its cards, images and earlier listings", () => {
  const items = buildTranscript([
    artifact("document", { outputSelected: true, fileName: "report.pdf" }, "/out/report.pdf"),
    artifact("image", { fileName: "chart.png" }, "/out/chart.png"),
  ], []);
  const names = knownOutputNames(items, [
    { descriptorJson: JSON.stringify({ name: "older.xlsx" }) },
    { descriptorJson: "{damaged" },
  ]);
  assert.deepEqual([...names].sort(), ["chart.png", "older.xlsx", "report.pdf"]);
});

test("a Code run links only its known outputs, never repository files", () => {
  const canOpen = fileLinkFilter({ outputNames: new Set(["report.pdf"]), markdownFallback: false });
  assert.equal(canOpen("/Users/me/project/out/report.pdf"), true);
  for (const path of ["README.md", "fixtures/users.csv", "public/logo.png", "index.html", "src/app.ts"]) {
    assert.equal(canOpen(path), false, path);
  }
});

test("Work and Chat also link Markdown the Mac can read from the run's folder", () => {
  const canOpen = fileLinkFilter({ outputNames: new Set(), markdownFallback: true });
  assert.equal(canOpen("notes/summary.md"), true);
  assert.equal(canOpen("summary.markdown#L3"), true);
  assert.equal(canOpen("data.csv"), false);
  assert.equal(canOpen("https://example.com/guide.md"), false);
});
