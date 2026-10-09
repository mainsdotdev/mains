import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getBackendRuntime, type ImagePreview } from "../../runtime/backend-runtime";

export const IMAGE_PREVIEW_CACHE_BYTES = 128 * 1024 * 1024;
export const MAX_PREVIEW_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const inflight = new Map<string, Promise<ImagePreview>>();
let queue: Promise<unknown> = Promise.resolve();
let nextPrune = 0;
let writtenSincePrune = 0;

export class UnsupportedImagePreviewError extends Error {
  constructor() { super("This image format cannot be previewed"); }
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function cacheRoot(): string {
  return path.join(getBackendRuntime().getPath("userData"), "cache", "image-previews");
}

function sourceVersion(stat: Stats): string {
  return JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}

async function readCached(directory: string, key: string, maxSide: number): Promise<ImagePreview | null> {
  try {
    if ((await fs.lstat(directory)).isSymbolicLink()) return null;
    const file = path.join(directory, `${key}.bin`);
    const metadataFile = path.join(directory, `${key}.json`);
    const [stat, metaStat] = await Promise.all([fs.lstat(file), fs.lstat(metadataFile)]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PREVIEW_BYTES ||
      !metaStat.isFile() || metaStat.isSymbolicLink() || metaStat.size > 4096) return null;
    const meta = JSON.parse(await fs.readFile(metadataFile, "utf8"));
    if (meta.byteSize !== stat.size || !["image/jpeg", "image/png"].includes(meta.mime) ||
      !Number.isInteger(meta.width) || !Number.isInteger(meta.height) ||
      meta.width < 1 || meta.height < 1 || Math.max(meta.width, meta.height) > maxSide) return null;
    const bytes = await fs.readFile(file);
    if (hash(bytes) !== meta.contentHash) return null;
    await fs.utimes(file, new Date(), new Date()).catch(() => {});
    return { bytes, mime: meta.mime, width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

async function writeCached(directory: string, key: string, image: ImagePreview): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("Invalid image preview directory");
  const temporary = path.join(directory, `.pending-${randomUUID()}`);
  try {
    await fs.writeFile(temporary, image.bytes, { flag: "wx", mode: 0o600 });
    await fs.writeFile(`${temporary}.json`, JSON.stringify({ mime: image.mime, width: image.width, height: image.height,
      byteSize: image.bytes.length, contentHash: hash(image.bytes) }), { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, path.join(directory, `${key}.bin`));
    await fs.rename(`${temporary}.json`, path.join(directory, `${key}.json`));
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    await fs.rm(`${temporary}.json`, { force: true }).catch(() => {});
  }
  writtenSincePrune += image.bytes.length;
  // Galleries can create hundreds of thumbnails at once. Avoid a full cache
  // directory walk for every tiny write; keep overshoot bounded by one batch.
  if (Date.now() >= nextPrune || writtenSincePrune >= 8 * 1024 * 1024) await pruneImagePreviews();
}

export async function pruneImagePreviews(budget = IMAGE_PREVIEW_CACHE_BYTES): Promise<void> {
  const root = cacheRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: Array<{ file: string; size: number; time: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    for (const child of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (!child.isFile() || !/^[a-f0-9]{64}\.bin$/.test(child.name)) continue;
      const file = path.join(directory, child.name);
      const stat = await fs.lstat(file).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) files.push({ file, size: stat.size, time: stat.mtimeMs });
    }
  }
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((a, b) => a.time - b.time)) {
    if (total <= budget) break;
    await fs.rm(file.file, { force: true });
    await fs.rm(file.file.replace(/\.bin$/, ".json"), { force: true });
    total -= file.size;
    await fs.rmdir(path.dirname(file.file)).catch(() => {});
  }
  nextPrune = Date.now() + 30_000;
  writtenSincePrune = 0;
}

/** Callers must authorize the source before entering this shared codec/cache. */
export async function readImagePreview(
  sourcePath: string,
  maxSide: number,
  { cache = true, preserveAlpha = false }: { cache?: boolean; preserveAlpha?: boolean } = {},
): Promise<ImagePreview> {
  if (!Number.isInteger(maxSide) || maxSide < 128 || maxSide > 2048) throw new Error("Invalid image preview size");
  const codec = getBackendRuntime().imagePreview;
  if (!codec) throw new Error("Image previews are unavailable on this backend");
  const stat = await fs.lstat(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid image file");
  if (stat.size > MAX_PREVIEW_SOURCE_BYTES) throw new Error("Image is too large to preview");
  const resolved = await fs.realpath(sourcePath);
  const version = sourceVersion(stat);
  const directory = path.join(cacheRoot(), hash(resolved));
  const key = hash(JSON.stringify([1, version, maxSide, preserveAlpha]));
  const identity = path.join(directory, key);
  const current = inflight.get(identity);
  if (current) return current;
  const task = enqueue(async () => {
    // Revalidate after waiting in the decode queue, even on a cache hit.
    if (sourceVersion(await fs.lstat(resolved)) !== version) throw new Error("Image changed while loading its preview");
    if (cache) {
      const hit = await readCached(directory, key, maxSide);
      if (hit) return hit;
    }
    const original = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      if (sourceVersion(await original.stat()) !== version) throw new Error("Image changed while loading its preview");
      bytes = await original.readFile();
      if (sourceVersion(await original.stat()) !== version) throw new Error("Image changed while loading its preview");
    } finally { await original.close(); }
    const image = await codec.resize(bytes, maxSide, preserveAlpha);
    if (!image) throw new UnsupportedImagePreviewError();
    if (!["image/jpeg", "image/png"].includes(image.mime) || image.bytes.length > MAX_PREVIEW_BYTES || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width < 1 || image.height < 1 || Math.max(image.width, image.height) > maxSide) throw new Error("Invalid image preview");
    if (cache) await writeCached(directory, key, image).catch((error) => console.error("[images] preview cache failed", error));
    return image;
  });
  inflight.set(identity, task);
  try { return await task; } finally { inflight.delete(identity); }
}

export async function removeImagePreviews(sourcePath: string): Promise<void> {
  const resolved = await fs.realpath(sourcePath).catch(() => path.resolve(sourcePath));
  await fs.rm(path.join(cacheRoot(), hash(resolved)), { recursive: true, force: true });
}

export async function drainImagePreviews(): Promise<void> {
  await queue;
}
