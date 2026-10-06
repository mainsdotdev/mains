import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactImage, ReadAttachmentImagePayload } from "@mains/contracts/runs";
import { getBackendRuntime, type ImagePreview } from "../../runtime/backend-runtime";
import { resolveRunAttachment } from "./run-attachment-storage";

export const ATTACHMENT_THUMBNAIL_SIDE = 256;
export const ATTACHMENT_PREVIEW_MAX_SIDE = 1600;
export const ATTACHMENT_THUMBNAIL_CACHE_BYTES = 128 * 1024 * 1024;
const inflight = new Map<string, Promise<ArtifactImage>>();
let queue: Promise<unknown> = Promise.resolve();

function cacheRoot(): string {
  return path.join(getBackendRuntime().getPath("userData"), "cache", "attachment-thumbnails");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}

async function readCached(directory: string): Promise<ImagePreview | null> {
  try {
    if ((await fs.lstat(directory)).isSymbolicLink()) return null;
    const file = path.join(directory, "256-v1.jpg");
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const sidecar = path.join(directory, "256-v1.json");
    const sidecarStat = await fs.lstat(sidecar);
    if (!sidecarStat.isFile() || sidecarStat.isSymbolicLink()) return null;
    const metadata = JSON.parse(await fs.readFile(sidecar, "utf8")) as { width: number; height: number; byteSize: number; contentHash: string };
    if (metadata.byteSize !== stat.size || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) ||
      metadata.width < 1 || metadata.height < 1 || Math.max(metadata.width, metadata.height) > ATTACHMENT_THUMBNAIL_SIDE) return null;
    const jpeg = await fs.readFile(file);
    if (createHash("sha256").update(jpeg).digest("hex") !== metadata.contentHash) return null;
    await fs.utimes(file, new Date(), new Date()).catch(() => {});
    return { jpeg, width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

async function writeCached(directory: string, image: ImagePreview): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("Invalid thumbnail directory");
  const pending = path.join(directory, `.pending-${randomUUID()}`);
  try {
    await fs.writeFile(pending, image.jpeg, { flag: "wx", mode: 0o600 });
    await fs.rename(pending, path.join(directory, "256-v1.jpg"));
    await fs.writeFile(`${pending}.json`, JSON.stringify({ width: image.width, height: image.height, byteSize: image.jpeg.length,
      contentHash: createHash("sha256").update(image.jpeg).digest("hex") }), { flag: "wx", mode: 0o600 });
    await fs.rename(`${pending}.json`, path.join(directory, "256-v1.json"));
  } finally {
    await fs.rm(pending, { force: true }).catch(() => {});
    await fs.rm(`${pending}.json`, { force: true }).catch(() => {});
  }
}

export async function pruneAttachmentThumbnails(budget = ATTACHMENT_THUMBNAIL_CACHE_BYTES): Promise<void> {
  const root = cacheRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: Array<{ directory: string; size: number; time: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    try {
      const stat = await fs.lstat(path.join(directory, "256-v1.jpg"));
      if (stat.isFile() && !stat.isSymbolicLink()) files.push({ directory, size: stat.size, time: stat.mtimeMs });
    } catch { /* incomplete cache entries are regenerated on demand */ }
  }
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((a, b) => a.time - b.time)) {
    if (total <= budget) break;
    await fs.rm(file.directory, { recursive: true, force: true });
    total -= file.size;
  }
}

export async function readAttachmentImage(payload: ReadAttachmentImagePayload): Promise<ArtifactImage> {
  const requested = payload.maxSide ?? ATTACHMENT_THUMBNAIL_SIDE;
  if (typeof requested !== "number" || !Number.isFinite(requested)) throw new Error("Invalid image preview size");
  const maxSide = Math.min(ATTACHMENT_PREVIEW_MAX_SIDE, Math.max(128, Math.round(requested)));
  // Validate ownership even on an in-flight/cache hit. No arbitrary path reads.
  const original = await resolveRunAttachment(payload.runId, payload.attachmentId);
  if (original.attachment.type !== "image") throw new Error("Not an image attachment");
  const runtime = getBackendRuntime();
  const codec = runtime.imagePreview;
  if (!codec) throw new Error("Image previews are unavailable on this backend");
  const root = cacheRoot();
  const key = JSON.stringify([root, payload.attachmentId, maxSide]);
  const hit = inflight.get(key);
  if (hit) return hit;
  const task = enqueue(async () => {
    const directory = path.join(root, payload.attachmentId);
    let preview = maxSide === ATTACHMENT_THUMBNAIL_SIDE ? await readCached(directory) : null;
    if (!preview) {
      preview = await codec.resizeToJpeg(await fs.readFile(original.path), maxSide);
      if (!preview) throw new Error("This image format cannot be previewed");
      if (maxSide === ATTACHMENT_THUMBNAIL_SIDE) {
        // A cache failure must not make an intact original disappear from UI.
        await writeCached(directory, preview).then(() => pruneAttachmentThumbnails()).catch((error) => console.error("[attachments] thumbnail cache failed", error));
      }
    }
    return { mime: "image/jpeg", base64: preview.jpeg.toString("base64"), width: preview.width, height: preview.height };
  });
  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}

export async function drainAttachmentImages(): Promise<void> {
  await queue;
}
