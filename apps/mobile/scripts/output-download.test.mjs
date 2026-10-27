import assert from "node:assert/strict";
import test from "node:test";
import { OUTPUT_CHUNK_BYTES, outputFileType } from "@mains/contracts/run-outputs";
import { downloadOutput, outputCacheSegments } from "../src/lib/output-download.ts";
import { outputReferenceName } from "../src/lib/output-reference.ts";
import { isDesktopOnlyOutput } from "../src/lib/output-presentation.ts";
import { buildTranscript } from "../src/lib/transcript.ts";
import { demoOutputs, readDemoOutput } from "../src/backend/demo/demo-outputs.ts";

const output = { runId: "run", artifactId: -42, name: "report.pdf", mimeType: "application/pdf", byteSize: OUTPUT_CHUNK_BYTES * 2 + 7, modifiedAt: 1, version: "a".repeat(64), previewType: "native" };
const source = Buffer.alloc(output.byteSize, 193);
const reader = async (request) => {
  const end = Math.min(request.offset + OUTPUT_CHUNK_BYTES, source.length);
  return { base64: source.subarray(request.offset, end).toString("base64"), offset: request.offset, nextOffset: end < source.length ? end : null, byteSize: source.length, version: output.version };
};

test("binary output downloads keep bounded chunks and finish with the exact original bytes", async () => {
  const writes = [], progress = [];
  await downloadOutput({ output, read: reader, write: (bytes) => { assert.ok(bytes.length <= OUTPUT_CHUNK_BYTES); writes.push(bytes); }, signal: new AbortController().signal, onProgress: (value) => progress.push(value) });
  assert.deepEqual(Buffer.concat(writes), source);
  assert.deepEqual(progress, [OUTPUT_CHUNK_BYTES, OUTPUT_CHUNK_BYTES * 2, source.length]);
});

test("cancellation discards a pending chunk before it is written", async () => {
  const controller = new AbortController(); let written = 0;
  await assert.rejects(downloadOutput({ output, read: async (request) => { controller.abort(); return reader(request); }, write: () => written++, signal: controller.signal }), /canceled/);
  assert.equal(written, 0);
});

test("changed revisions, truncated transfers and oversized chunks cannot be committed", async () => {
  for (const patch of [{ version: "changed" }, { offset: 1 }, { byteSize: 0 }, { base64: "", nextOffset: 0 }, { nextOffset: null }, { base64: Buffer.alloc(OUTPUT_CHUNK_BYTES + 1).toString("base64") }]) {
    let written = 0;
    await assert.rejects(downloadOutput({ output, read: async (request) => ({ ...await reader(request), ...patch }), write: () => written++, signal: new AbortController().signal }));
    assert.equal(written, 0);
  }
});

test("cache identities isolate computers, conversations and revisions while retaining a shareable filename", () => {
  assert.equal(outputCacheSegments("computer", output).at(-1), "report.pdf");
  assert.notDeepEqual(outputCacheSegments("a", output), outputCacheSegments("b", output));
  assert.notDeepEqual(outputCacheSegments("a", output), outputCacheSegments("a", { ...output, runId: "other" }));
  assert.notDeepEqual(outputCacheSegments("a", output), outputCacheSegments("a", { ...output, version: "b".repeat(64) }));
  const unsafe = outputCacheSegments("../computer", { ...output, runId: "../run", name: "../../report.pdf" });
  assert.ok(unsafe.every((part) => !part.includes("/") && !part.includes("\\") && part !== ".."));
});

test("local document links resolve selected names and preserve ordinary web links", () => {
  assert.equal(outputReferenceName("/workspace/reports/Quarterly%20report.PDF"), "Quarterly report.PDF");
  assert.equal(outputReferenceName("./report.md#L12-14"), "report.md");
  assert.equal(outputReferenceName("C:\\reports\\slides.pptx"), "slides.pptx");
  assert.equal(outputReferenceName("file:///workspace/report.docx"), "report.docx");
  assert.equal(outputReferenceName("./dashboard.HTML#chart"), "dashboard.HTML");
  assert.equal(outputReferenceName("https://mains.dev/report.pdf"), null);
  assert.equal(outputReferenceName("https://mains.dev/dashboard.html"), null);
  assert.equal(outputReferenceName("javascript:report.pdf"), null);
  assert.equal(outputReferenceName("#section"), null);
  assert.equal(outputFileType("report.XLSX").previewType, "native");
  assert.equal(outputFileType("page.html").previewType, "unsupported");
});

test("HTML formats, HTML MIME types and interactive artifacts require desktop while ordinary documents stay available", () => {
  for (const name of ["dashboard.html", "report.HTM", "chart.xhtml"]) assert.equal(isDesktopOnlyOutput({ name }), true);
  assert.equal(isDesktopOnlyOutput({ name: "dashboard", mimeType: "text/html; charset=utf-8" }), true);
  assert.equal(isDesktopOnlyOutput({ name: "dashboard", mimeType: "application/xhtml+xml" }), true);
  assert.equal(isDesktopOnlyOutput({ name: "Interactive chart", kind: "visualization" }), true);
  for (const name of ["report.pdf", "notes.md", "data.csv", "report.docx", "chart.svg"]) assert.equal(isDesktopOnlyOutput({ name }), false);
});

test("desktop-only outputs never request or write file bytes, even under a misleading filename", async () => {
  for (const patch of [{ name: "dashboard.html" }, { name: "dashboard.pdf", mimeType: "text/html" }]) {
    let reads = 0, writes = 0;
    await assert.rejects(downloadOutput({ output: { ...output, ...patch }, read: async (request) => { reads++; return reader(request); }, write: () => writes++, signal: new AbortController().signal }), /See on desktop/);
    assert.equal(reads, 0);
    assert.equal(writes, 0);
  }
});

test("interactive transcript artifacts become desktop notices without exposing HTML bodies or host paths", () => {
  const artifact = (id, kind, path, metadata = {}) => ({ backendId: "b", runId: "r", id, kind, path, content: "<html><script>interactive()</script></html>", metadataJson: JSON.stringify(metadata), createdAt: new Date(id) });
  const items = buildTranscript([
    artifact(1, "visualization", "/private/run/chart.html", { title: "Budget forecast", mobileContentDeferred: { chars: 50000 } }),
    // Files reach the phone as the backend's selected outputs, which carry the flag.
    artifact(2, "file", "/private/run/dashboard.html", { fileName: "Dashboard", outputSelected: true }),
    artifact(3, "visualization", null),
    artifact(4, "document", "/private/run/report.pdf", { outputSelected: true }),
  ], []);
  assert.deepEqual(items.map((item) => [item.kind, item.name, item.desktopOnly === true]), [
    ["document", "Budget forecast", true], ["document", "Dashboard", true], ["document", "Interactive output", true], ["document", "report.pdf", false],
  ]);
  assert.ok(!JSON.stringify(items).includes("<html>"));
  assert.ok(!JSON.stringify(items).includes("/private/run/"));
  assert.ok(items.every((item) => !item.fullContent));
});

test("the bundled demo PDF exercises the same original-file protocol without a connected account", async () => {
  const [pdf] = demoOutputs("demo-run");
  const writes = [];
  await downloadOutput({ output: pdf, read: async (request) => readDemoOutput(request), write: (bytes) => writes.push(bytes), signal: new AbortController().signal });
  const text = Buffer.concat(writes).toString();
  assert.ok(text.startsWith("%PDF-1.4"));
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(xref).startsWith("xref\n"));
  assert.ok(text.includes("Mains Demo Report"));
});
