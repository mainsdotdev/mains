import assert from "node:assert/strict";
import test from "node:test";
import { CHANNELS } from "@mains/contracts/channels";
import { OUTPUT_CHUNK_BYTES } from "@mains/contracts/run-outputs";
import { AttachmentFileReader, LEGACY_ATTACHMENT_MAX_BYTES } from "../src/backend/attachment-files.ts";

const attachmentId = "a".repeat(64);
const source = Buffer.alloc(OUTPUT_CHUNK_BYTES * 12 + 7, 193);
const hint = { name: "Özgeçmiş.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: source.length };
const missing = (channel) => ({ success: false, error: `Channel "${channel}" is not available to paired devices` });

test("an older paired backend opens an existing document through its permitted original-file reader", async () => {
  const calls = [];
  const transport = { invoke: async (channel, [payload]) => {
    calls.push(channel);
    if (channel === CHANNELS.runArtifacts.readAttachmentFile) return { success: true, data: { ...hint, attachmentId: payload.attachmentId, type: "document", base64: source.toString("base64") } };
    return { success: false, error: `Channel "${channel}" is not available to paired devices` };
  } };
  const reader = new AttachmentFileReader();
  const file = await reader.describe(transport, "mac", "run", attachmentId, hint);
  const chunks = [];
  let offset = 0;
  do {
    const chunk = await reader.readChunk(transport, "mac", { runId: "run", attachmentId, version: file.version, offset });
    const bytes = Buffer.from(chunk.base64, "base64");
    assert.ok(bytes.length <= OUTPUT_CHUNK_BYTES);
    chunks.push(bytes);
    offset = chunk.nextOffset;
  } while (offset !== null);
  assert.deepEqual(Buffer.concat(chunks), source);
  assert.equal(file.name, hint.name);
  assert.equal(file.previewType, "native");
  assert.equal(calls.filter((channel) => channel === CHANNELS.runArtifacts.readAttachmentFile).length, 1);
  assert.ok(!calls.includes(CHANNELS.runArtifacts.readAttachmentChunk));
});

test("updated backends keep the chunked protocol without fetching an original", async () => {
  const calls = [];
  const file = { ...hint, attachmentId, runId: "run", version: "b".repeat(64), modifiedAt: 1, previewType: "native" };
  const chunk = { base64: "eA==", version: file.version, offset: 0, nextOffset: null, byteSize: 1 };
  const transport = { invoke: async (channel) => { calls.push(channel); return { success: true, data: channel === CHANNELS.runArtifacts.describeAttachmentFile ? file : chunk }; } };
  const reader = new AttachmentFileReader();
  assert.deepEqual(await reader.describe(transport, "mac", "run", attachmentId), file);
  assert.deepEqual(await reader.readChunk(transport, "mac", { runId: "run", attachmentId, version: file.version, offset: 0 }), chunk);
  assert.deepEqual(calls, [CHANNELS.runArtifacts.describeAttachmentFile, CHANNELS.runArtifacts.readAttachmentChunk]);
});

test("unknown-size and large originals require a desktop update before any full-file request", async () => {
  for (const metadata of [null, { name: hint.name }, { ...hint, byteSize: LEGACY_ATTACHMENT_MAX_BYTES + 1 }]) {
    const calls = [];
    const transport = { invoke: async (channel) => { calls.push(channel); return missing(channel); } };
    await assert.rejects(new AttachmentFileReader().describe(transport, "mac", "run", attachmentId, metadata), /Update and restart Mains on your computer/);
    assert.deepEqual(calls, [CHANNELS.runArtifacts.describeAttachmentFile]);
  }
});

test("real attachment errors do not fall back to another reader", async () => {
  const calls = [];
  const transport = { invoke: async (channel) => { calls.push(channel); return { success: false, error: "Attachment not found in this conversation" }; } };
  await assert.rejects(new AttachmentFileReader().describe(transport, "mac", "run", attachmentId, hint), /not found/);
  assert.deepEqual(calls, [CHANNELS.runArtifacts.describeAttachmentFile]);
});

test("truncated and substituted originals cannot enter the compatibility cache", async () => {
  for (const patch of [{ attachmentId: "b".repeat(64) }, { byteSize: 1 }, { base64: "eA==" }, { name: "other.docx" }]) {
    const transport = { invoke: async (channel) => channel === CHANNELS.runArtifacts.readAttachmentFile
      ? { success: true, data: { ...hint, attachmentId, type: "document", base64: source.toString("base64"), ...patch } } : missing(channel) };
    await assert.rejects(new AttachmentFileReader().describe(transport, "mac", "run", attachmentId, hint));
  }
});

test("compatibility copies are scoped by backend and run, reject stale versions and release on forgetting", async () => {
  const transport = { invoke: async (channel) => channel === CHANNELS.runArtifacts.readAttachmentFile
    ? { success: true, data: { ...hint, attachmentId, type: "document", base64: source.toString("base64") } } : missing(channel) };
  const reader = new AttachmentFileReader();
  const file = await reader.describe(transport, "mac", "run", attachmentId, hint);
  const request = { runId: "run", attachmentId, version: file.version, offset: 0 };
  await assert.rejects(reader.readChunk(transport, "other-mac", request));
  await assert.rejects(reader.readChunk(transport, "mac", { ...request, runId: "other-run" }));
  await assert.rejects(reader.readChunk(transport, "mac", { ...request, version: "c".repeat(64) }), /changed/);
  reader.clear();
  await assert.rejects(reader.readChunk(transport, "mac", request), /expired/);
});

test("HTML stays desktop-only even on a legacy backend", async () => {
  const calls = [];
  const transport = { invoke: async (channel) => { calls.push(channel); return missing(channel); } };
  await assert.rejects(new AttachmentFileReader().describe(transport, "mac", "run", attachmentId, { name: "app.html", mimeType: "text/html", byteSize: 50 }), /See on desktop/);
  assert.deepEqual(calls, [CHANNELS.runArtifacts.describeAttachmentFile]);
});

test("upgrading the desktop abandons an incomplete legacy copy and resumes the native chunk reader", async () => {
  let upgraded = false;
  const modern = { ...hint, attachmentId, runId: "run", version: "b".repeat(64), modifiedAt: 1, previewType: "native" };
  const transport = { invoke: async (channel) => {
    if (upgraded) return { success: true, data: channel === CHANNELS.runArtifacts.describeAttachmentFile ? modern : { base64: "eA==", version: modern.version, offset: 0, nextOffset: null, byteSize: 1 } };
    return channel === CHANNELS.runArtifacts.readAttachmentFile ? { success: true, data: { ...hint, attachmentId, type: "document", base64: source.toString("base64") } } : missing(channel);
  } };
  const reader = new AttachmentFileReader();
  await reader.describe(transport, "mac", "run", attachmentId, hint);
  upgraded = true;
  const file = await reader.describe(transport, "mac", "run", attachmentId, hint);
  assert.equal((await reader.readChunk(transport, "mac", { runId: "run", attachmentId, version: file.version, offset: 0 })).base64, "eA==");
});

test("legacy copies expire and stay within their shared memory budget", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const transport = { invoke: async (channel, [payload]) => channel === CHANNELS.runArtifacts.readAttachmentFile
    ? { success: true, data: { ...hint, attachmentId: payload.attachmentId, type: "document", base64: source.toString("base64") } } : missing(channel) };
  const reader = new AttachmentFileReader();
  const files = [];
  for (const letter of ["a", "b", "c"]) files.push(await reader.describe(transport, "mac", "run", letter.repeat(64), hint));
  await assert.rejects(reader.readChunk(transport, "mac", { runId: "run", attachmentId: files[0].attachmentId, version: files[0].version, offset: 0 }), /expired/);
  assert.equal((await reader.readChunk(transport, "mac", { runId: "run", attachmentId: files[2].attachmentId, version: files[2].version, offset: 0 })).nextOffset, OUTPUT_CHUNK_BYTES);
  now += 61_000;
  await assert.rejects(reader.readChunk(transport, "mac", { runId: "run", attachmentId: files[2].attachmentId, version: files[2].version, offset: 0 }), /expired/);
});

test("forgetting a computer while its original is loading cannot repopulate the memory cache", async () => {
  let started, finish;
  const ready = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { finish = resolve; });
  const transport = { invoke: async (channel) => {
    if (channel === CHANNELS.runArtifacts.readAttachmentFile) { started(); return pending; }
    return missing(channel);
  } };
  const reader = new AttachmentFileReader();
  const opening = reader.describe(transport, "mac", "run", attachmentId, hint);
  await ready;
  reader.clear();
  finish({ success: true, data: { ...hint, attachmentId, type: "document", base64: source.toString("base64") } });
  await assert.rejects(opening, /computer changed/);
});
