import { promises as fs } from "node:fs";
import { MOBILE_OUTPUT_MAX_BYTES, outputFileType, type ReadRunAttachmentPayload, type RunAttachmentFile } from "@mains/contracts/run-outputs";
import type { ResolveAttachmentPathPayload } from "@mains/contracts/runs";
import { resolveRunAttachment } from "./run-attachment-storage";
import { attachmentFileRevision, readRunFileChunk, validateOutputReference } from "./run-output-files";
import { runsRepo } from "./runs.repo";

const selections = new Map<string, { file: RunAttachmentFile; path: string; contentHash: string; expiresAt: number }>();

async function selectedAttachment(payload: ResolveAttachmentPathPayload) {
  validateOutputReference(payload?.runId);
  if (typeof payload.attachmentId !== "string" || !/^[a-f0-9]{64}$/.test(payload.attachmentId)) throw new Error("Invalid attachment reference");
  const { attachment, path } = await resolveRunAttachment(payload.runId, payload.attachmentId);
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== attachment.byteSize || stat.size > MOBILE_OUTPUT_MAX_BYTES) throw new Error("Attachment is unavailable or too large");
  const file: RunAttachmentFile = { runId: payload.runId, attachmentId: attachment.id, name: attachment.name, byteSize: stat.size,
    modifiedAt: stat.mtimeMs, version: attachmentFileRevision(payload.runId, attachment.id, stat),
    ...outputFileType(attachment.name), mimeType: attachment.mimeType };
  return { file, path, contentHash: attachment.contentHash };
}

export async function describeAttachmentFile(payload: ResolveAttachmentPathPayload): Promise<RunAttachmentFile> {
  return (await selectedAttachment(payload)).file;
}

export async function readAttachmentChunk(payload: ReadRunAttachmentPayload) {
  if (typeof payload?.version !== "string" || !/^[a-f0-9]{64}$/.test(payload.version) || !Number.isSafeInteger(payload.offset) || payload.offset < 0) throw new Error("Invalid attachment download");
  validateOutputReference(payload.runId);
  if (typeof payload.attachmentId !== "string" || !/^[a-f0-9]{64}$/.test(payload.attachmentId)) throw new Error("Invalid attachment reference");
  // Recheck the owning reference on every chunk, but hydrate a verified Bridge
  // original only once per download rather than hashing its whole file again.
  const current = runsRepo.findAttachment(payload.runId, payload.attachmentId);
  if (!current) throw new Error("Attachment not found in this conversation");
  const key = JSON.stringify([payload.runId, payload.attachmentId, payload.version]);
  let selection = payload.offset > 0 ? selections.get(key) : undefined;
  if (!selection || selection.expiresAt < Date.now() || selection.contentHash !== current.contentHash || selection.file.byteSize !== current.byteSize) {
    selection = { ...await selectedAttachment(payload), expiresAt: Date.now() + 300_000 };
    selections.set(key, selection);
    if (selections.size > 64) selections.delete(selections.keys().next().value!);
  }
  selection.expiresAt = Date.now() + 300_000;
  const { file, path } = selection;
  return readRunFileChunk(file, path, payload, (stat) => attachmentFileRevision(payload.runId, payload.attachmentId, stat));
}
