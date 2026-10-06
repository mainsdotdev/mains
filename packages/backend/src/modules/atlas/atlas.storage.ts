import { createHash, randomUUID } from "node:crypto";
import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { getBackendRuntime } from "../../runtime/backend-runtime";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
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
export async function writeFile(id: string, name: string, bytes: Buffer) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error("File exceeds the 100 MB Atlas limit");
  const directory = path.join(atlasRoot(), id);
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
  await fs.rm(path.join(atlasRoot(), id), { recursive: true, force: true });
}
