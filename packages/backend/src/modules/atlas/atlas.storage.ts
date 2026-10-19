import { createHash, randomUUID } from "node:crypto";
import { promises as fs, constants, type Stats } from "node:fs";
import path from "node:path";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { removeImagePreviews } from "../imageProxy";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const imageHashes = new Map<string, { signature: string; value: Promise<string> }>();
export const atlasRoot = () => path.join(getBackendRuntime().getPath("userData"), "atlas", "files");
export const fileHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const sourceKey = (runId: string, absPath: string) =>
  createHash("sha256").update(JSON.stringify([runId, path.resolve(absPath)])).digest("hex");

export function safeName(value: string): string {
  const clean = [...path.basename(value)].map((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || "/\\:".includes(char) ? "_" : char).join("");
  const extension = path.extname(clean);
  let stem = clean.slice(0, clean.length - extension.length);
  // Bound UTF-8 bytes while keeping the extension used for MIME classification.
  while (Buffer.byteLength(stem + extension) > 180 && stem.length) stem = [...stem].slice(0, -1).join("");
  const name = stem + extension;
  if (!name || name === "." || name === ".." || name.startsWith(".")) throw new Error("Invalid file name");
  return name;
}
export function storagePath(key: string): string {
  if (!/^[\w-]+\/[^/\\]+$/.test(key) || [".", ".."].includes(path.basename(key))) throw new Error("Invalid Atlas file key");
  return path.join(atlasRoot(), key);
}
/** Folders exist only for this device's random item ids. An id synced from
 * another device must never select a path outside the Atlas folder. */
function itemDirectory(id: string): string | null {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? path.join(atlasRoot(), id) : null;
}
function within(root: string, child: string) {
  const relative = path.relative(root, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
export async function inspectSource(file: string, roots: string[]) {
  if (!path.isAbsolute(file) || file.includes("\0")) throw new Error("Invalid file path");
  const stats = await fs.lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Only regular files can be saved");
  if (stats.size > MAX_FILE_BYTES) throw new Error("File exceeds the 100 MB Atlas limit");
  const real = await fs.realpath(file);
  for (const root of roots) {
    try {
      if (within(await fs.realpath(root), real)) return { real, stats };
    } catch { /* A removed run directory does not admit a file. */ }
  }
  throw new Error("File is outside this conversation's output folders");
}
export async function readSource(file: string, roots: string[]) {
  const { real, stats } = await inspectSource(file, roots);
  const handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== stats.ino || opened.dev !== stats.dev || opened.size > MAX_FILE_BYTES)
      throw new Error("File changed while saving; try again");
    const bytes = await handle.readFile();
    if (bytes.length > MAX_FILE_BYTES) throw new Error("File exceeds the 100 MB Atlas limit");
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
      throw new Error("File changed while saving; try again");
    return bytes;
  } finally { await handle.close(); }
}

/** Stream validated images once per file version, without retaining pixels. */
export async function imageContentHash(real: string, stats: Stats): Promise<string> {
  const signature = [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join(":");
  const cached = imageHashes.get(real);
  if (cached?.signature === signature) {
    imageHashes.delete(real);
    imageHashes.set(real, cached);
    return cached.value;
  }
  const value = (async () => {
    const handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== stats.ino || opened.dev !== stats.dev || opened.size !== stats.size
        || opened.size > MAX_FILE_BYTES || opened.mtimeMs !== stats.mtimeMs || opened.ctimeMs !== stats.ctimeMs)
        throw new Error("Image changed while listing");
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      const after = await handle.stat();
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
        throw new Error("Image changed while listing");
      return hash.digest("hex");
    } finally { await handle.close(); }
  })();
  imageHashes.set(real, { signature, value });
  if (imageHashes.size > 128) imageHashes.delete(imageHashes.keys().next().value!);
  try { return await value; }
  catch (error) {
    if (imageHashes.get(real)?.value === value) imageHashes.delete(real);
    throw error;
  }
}
export async function writeFile(id: string, name: string, bytes: Buffer) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error("File exceeds the 100 MB Atlas limit");
  const directory = itemDirectory(id);
  if (!directory) throw new Error("Invalid Atlas item id");
  const temporary = path.join(atlasRoot(), `.pending-${randomUUID()}`);
  await fs.mkdir(temporary, { recursive: true });
  try {
    const handle = await fs.open(path.join(temporary, name), "wx", 0o444);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, directory);
    return `${id}/${name}`;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
export async function removeFiles(id: string) {
  // No folder of ours can have any other id, so there is nothing to remove.
  const directory = itemDirectory(id);
  if (!directory) return;
  for (const file of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (file.isFile()) await removeImagePreviews(path.join(directory, file.name)).catch(() => {});
  }
  await fs.rm(directory, { recursive: true, force: true });
}
