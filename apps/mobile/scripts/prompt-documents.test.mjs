import assert from "node:assert/strict";
import test from "node:test";
import { parsePromptDocuments } from "../src/lib/prompt-documents.ts";
import { buildTranscript } from "../src/lib/transcript.ts";
import { outputCacheSegments, downloadRunFile } from "../src/lib/output-download.ts";
import { initialOptimisticPromptState, projectOptimisticPrompt } from "../src/features/runs/lib/optimistic-prompt.ts";
import { DEMO_ATTACHMENT_ID, demoAttachmentFile, readDemoAttachment } from "../src/backend/demo/demo-outputs.ts";

test("same-name prompt documents keep their durable identity without paths or binary data", () => {
  const documents = parsePromptDocuments([
    { type: "document", name: "report.pdf", attachmentId: "a".repeat(64), byteSize: 50, mimeType: "application/pdf", sourcePath: "/private/report.pdf", data: "excluded" },
    { type: "document", name: "report.pdf", attachmentId: "b".repeat(64) },
    { type: "image", name: "photo.png" }, null,
  ], "run");
  assert.equal(documents.length, 2);
  assert.notEqual(documents[0].attachmentId, documents[1].attachmentId);
  assert.equal(documents[0].runId, "run");
  assert.ok(!JSON.stringify(documents).includes("/private/"));
  assert.ok(!JSON.stringify(documents).includes("excluded"));
});

test("document-only prompts remain visible and legacy documents do not become filesystem links", () => {
  const items = buildTranscript([{ backendId: "mac", runId: "run", id: 1, kind: "user-prompt", content: "", path: null, metadataJson: JSON.stringify({ attachments: [
    { type: "document", name: "report.pdf", attachmentId: "a".repeat(64) },
    { type: "document", name: "legacy.pdf", path: "/private/legacy.pdf" },
  ] }), createdAt: new Date() }], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "prompt");
  assert.equal(items[0].documents.length, 2);
  assert.equal(items[0].documents[1].attachmentId, undefined);
  assert.ok(!JSON.stringify(items).includes("/private/"));
});

test("an optimistic document stays visible until its durable prompt takes over", () => {
  const initialPrompt = { text: "", skills: [], attachments: [{ id: "local", name: "report.pdf", type: "document", uri: "file:///private/draft.pdf", mimeType: "application/pdf", size: 50 }] };
  const state = initialOptimisticPromptState(initialPrompt);
  const result = projectOptimisticPrompt({ state, initialPrompt, runId: "run", durableItems: [], streamingItems: [], runIsLive: true });
  assert.equal(result.pendingItem.documents[0].pending, true);
  assert.equal(result.pendingItem.documents[0].name, "report.pdf");
  assert.ok(!JSON.stringify(result.pendingItem).includes("/private/"));
  const durable = { key: "stored", kind: "prompt", text: "", images: [], files: [], skills: [], documents: parsePromptDocuments([{ name: "report.pdf", type: "document", attachmentId: "a".repeat(64) }], "run") };
  assert.equal(projectOptimisticPrompt({ state, initialPrompt, runId: "run", durableItems: [durable], streamingItems: [], runIsLive: false }).pendingItem, null);
});

test("attachment downloads share the bounded reader while their cache identity remains distinct", async () => {
  const file = demoAttachmentFile("run", DEMO_ATTACHMENT_ID);
  const writes = [];
  await downloadRunFile({ output: file, read: (offset) => Promise.resolve(readDemoAttachment({ runId: "run", attachmentId: file.attachmentId, version: file.version, offset })), write: (bytes) => writes.push(bytes), signal: new AbortController().signal });
  assert.ok(Buffer.concat(writes).toString().startsWith("%PDF-1.4"));
  const cache = outputCacheSegments("mac", file);
  assert.notDeepEqual(cache, outputCacheSegments("other-mac", file));
  assert.notDeepEqual(cache, outputCacheSegments("mac", { ...file, attachmentId: "a".repeat(64) }));
  const { attachmentId: _id, ...descriptor } = file;
  assert.notDeepEqual(cache, outputCacheSegments("mac", { ...descriptor, artifactId: -9001 }));
});
