import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FileAttachment as UploadAttachment, StoredAttachment } from "@mains/contracts/runs";
import type { FileAttachment } from "../../../shared/adapter.types";
import type { runAttachments } from "../../db/schema";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { removeImagePreviews } from "../imageProxy";
import { attachmentFileName } from "./run-attachments";
import { runsRepo } from "./runs.repo";

type AttachmentRow = typeof runAttachments.$inferSelect;
const activeWrites = new Set<string>();
const pendingInputs = new Map<string, Promise<FileAttachment[]>>();
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

async function fileHash(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function attachmentRoot(): string {
  return path.join(getBackendRuntime().getPath("userData"), "attachments");
}

export function attachmentDescriptor(attachment: FileAttachment): StoredAttachment {
  const { attachmentId, name, type, mimeType, byteSize } = attachment;
  return { attachmentId, name, type, mimeType, byteSize };
}

function storageKey(id: string, name: string): string {
  if (!/^[a-f0-9]{64}$/.test(id) || attachmentFileName(name) !== name) throw new Error("Invalid attachment storage key");
  return `attachments/${id}/${name}`;
}

async function resolvedPath(row: Pick<AttachmentRow, "id" | "name" | "storageKey">): Promise<string> {
  if (row.storageKey !== storageKey(row.id, row.name)) throw new Error("Invalid attachment storage key");
  const root = attachmentRoot();
  const directory = path.join(root, row.id);
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("Invalid attachment directory");
  const [realRoot, realDirectory] = await Promise.all([fs.realpath(root), fs.realpath(directory)]);
  if (path.dirname(realDirectory) !== realRoot) throw new Error("Attachment is outside its storage directory");
  return path.join(realDirectory, row.name);
}

async function originalPath(row: AttachmentRow, verifyHash = false): Promise<string> {
  const result = await resolvedPath(row);
  const stat = await fs.lstat(result);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.byteSize) throw new Error("Attachment file is missing or damaged");
  if (verifyHash && await fileHash(result) !== row.contentHash) throw new Error("Attachment file is damaged");
  return result;
}

function prepared(row: AttachmentRow, sourcePath: string): FileAttachment {
  return { attachmentId: row.id, name: row.name, type: row.type, mimeType: row.mimeType, byteSize: row.byteSize, sourcePath };
}

async function persistOne(runId: string, inputKey: string, ordinal: number, input: UploadAttachment): Promise<FileAttachment> {
  const existing = runsRepo.findAttachmentForInput(runId, inputKey, ordinal);
  if (existing) {
    if (existing.name !== attachmentFileName(input.name) || existing.type !== input.type || existing.mimeType !== input.mimeType) throw new Error("This message already has different attachments");
    // An uncertain ACK retry may arrive after the original capture was evicted.
    return prepared(existing, await originalPath(existing, true));
  }
  const id = createHash("sha256").update(JSON.stringify([runId, inputKey, ordinal])).digest("hex");
  activeWrites.add(id);
  const name = attachmentFileName(input.name);
  const directory = path.join(attachmentRoot(), id);
  const pending = path.join(directory, `.pending-${randomUUID()}`);
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const key = storageKey(id, name);
    const target = await resolvedPath({ id, name, storageKey: key });
    if (input.sourcePath) {
      // Caller has already narrowed the capture trust boundary.
      const sourceStat = await fs.lstat(input.sourcePath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error("Attachment capture is missing");
      await fs.copyFile(input.sourcePath, pending, 1 /* COPYFILE_EXCL */);
      await fs.chmod(pending, 0o600);
    } else if (typeof input.data === "string") {
      // Reject malformed base64 rather than silently persisting truncated bytes.
      const data = input.data.replace(/\s/g, "");
      if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("Attachment data is invalid");
      await fs.writeFile(pending, Buffer.from(data, "base64"), { flag: "wx", mode: 0o600 });
    } else {
      throw new Error("Attachment file data is missing");
    }
    const byteSize = (await fs.stat(pending)).size;
    const contentHash = await fileHash(pending);
    await fs.chmod(pending, 0o444);
    const handle = await fs.open(pending, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    await fs.rename(pending, target);
    // Verification precedes the reference: a crash can leave an orphan, never
    // a committed history reference pointing at a half-written original.
    if ((await fs.stat(target)).size !== byteSize || await fileHash(target) !== contentHash) throw new Error("Attachment could not be verified");
    const directoryHandle = await fs.open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    runsRepo.retainAttachment(runId, inputKey, ordinal, { id, name, type: input.type, mimeType: input.mimeType, storageKey: key, byteSize, contentHash });
    const row = runsRepo.findAttachment(runId, id);
    if (!row) throw new Error("Attachment could not be saved");
    return prepared(row, target);
  } finally {
    await fs.rm(pending, { force: true }).catch(() => {});
    activeWrites.delete(id);
  }
}

/** Persist one message serially, keeping only one decoded upload in memory. */
export async function prepareRunAttachments(
  runId: string,
  attachments: UploadAttachment[] | undefined,
  clientUserMessageId?: string,
): Promise<FileAttachment[] | undefined> {
  if (!attachments?.length) return undefined;
  const inputKey = clientUserMessageId ?? `message:${randomUUID()}`;
  const key = JSON.stringify([attachmentRoot(), runId, inputKey]);
  const current = pendingInputs.get(key);
  if (current) return current;
  const task = (async () => {
    const result: FileAttachment[] = [];
    for (const [ordinal, input] of attachments.entries()) result.push(await persistOne(runId, inputKey, ordinal, input));
    return result;
  })();
  pendingInputs.set(key, task);
  try { return await task; } finally { pendingInputs.delete(key); }
}

export async function resolveRunAttachment(runId: string, attachmentId: string): Promise<{ attachment: AttachmentRow; path: string }> {
  if (typeof runId !== "string" || typeof attachmentId !== "string") throw new Error("Invalid attachment reference");
  const attachment = runsRepo.findAttachment(runId, attachmentId);
  if (!attachment) throw new Error("Attachment not found in this conversation");
  return { attachment, path: await originalPath(attachment) };
}

/** A read-only projection of this run's verified originals, without loading bytes. */
export async function listRunAttachmentFiles(runId: string) {
  const result: Array<{ attachmentId: string; path: string; type: AttachmentRow["type"] }> = [];
  for (const attachment of runsRepo.listAttachments(runId)) {
    try {
      result.push({ attachmentId: attachment.id, type: attachment.type, path: await originalPath(attachment) });
    } catch { /* Missing legacy originals must not hide the remaining library. */ }
  }
  return result;
}

/** Last-reference cleanup also catches cascaded account/workspace deletions. */
export async function pruneUnreferencedAttachments(): Promise<void> {
  for (;;) {
    const rows = runsRepo.listUnreferencedAttachments();
    let removed = 0;
    for (const row of rows) {
      if (!/^[a-f0-9]{64}$/.test(row.id)) throw new Error("Invalid attachment identity");
      if (activeWrites.has(row.id)) continue;
      const claimed = runsRepo.claimUnreferencedAttachment(row.id);
      if (!claimed) continue;
      removed++;
      await removeImagePreviews(path.join(attachmentRoot(), row.id, row.name)).catch(() => {});
      await fs.rm(path.join(attachmentRoot(), row.id), { recursive: true, force: true }).catch((error) => console.error("[attachments] cleanup failed", error));
      await fs.rm(path.join(getBackendRuntime().getPath("userData"), "cache", "attachment-thumbnails", row.id), { recursive: true, force: true }).catch(() => {});
    }
    if (!removed || rows.length < 100) return;
  }
}

export async function pruneAttachmentOrphans(now = Date.now()): Promise<void> {
  const root = attachmentRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name) || activeWrites.has(entry.name)) continue;
    const directory = path.join(root, entry.name);
    if (!runsRepo.findStoredAttachment(entry.name)) {
      const stat = await fs.lstat(directory);
      if (now - stat.mtimeMs > ORPHAN_GRACE_MS) await fs.rm(directory, { recursive: true, force: true });
      continue;
    }
    for (const file of await fs.readdir(directory, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.startsWith(".pending-")) continue;
      const target = path.join(directory, file.name);
      if (now - (await fs.lstat(target)).mtimeMs > ORPHAN_GRACE_MS) await fs.rm(target, { force: true });
    }
  }
}
