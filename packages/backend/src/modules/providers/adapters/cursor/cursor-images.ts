import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { OUTPUT_FILE_MAX_BYTES, OUTPUT_IMAGE_EXTENSIONS } from "@mains/contracts/output-files";
import type { WorkRunEvent } from "../../../../../shared/adapter.types";
import { managedRunImageDir } from "../../../runs/run-execution";

const within = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/** Capture only the explicitly reported output, never scan Cursor's asset cache.
 * Cursor saves images outside cwd. A run-owned copy uses the existing output
 * read/preview/Bridge roots without granting access to other Cursor projects.
 */
export async function captureCursorImage(runId: string, cwd: string, params: unknown): Promise<WorkRunEvent | null> {
  const input = params as { filePath?: unknown; toolCallId?: unknown; referenceImagePaths?: unknown } | null;
  if (typeof input?.filePath !== "string" || !input.filePath.trim()) return null;
  const metadata = { source: "cursor_image_generation", cursorExtension: "generate_image",
    ...(typeof input.toolCallId === "string" ? { toolCallId: input.toolCallId } : {}) };
  try {
    const source = path.resolve(cwd, input.filePath);
    const extension = path.extname(source).slice(1).toLowerCase();
    if (!OUTPUT_IMAGE_EXTENSIONS.has(extension)) throw new Error("Unsupported image format");
    const realCwd = await fs.realpath(cwd);
    // Cursor's workspace-paths helper uses this project directory encoding.
    const nativeRoots = [...new Set([cwd, realCwd])].map((root) => path.join(os.homedir(), ".cursor", "projects",
      root.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, ""), "assets"));
    const roots = await Promise.all([realCwd, ...nativeRoots].map((root) => fs.realpath(root).catch(() => null)));
    const realSource = await fs.realpath(source);
    if (!roots.some((root) => root && within(root, realSource))) throw new Error("Image is outside this workspace's output folders");
    const handle = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size === 0 || before.size > OUTPUT_FILE_MAX_BYTES) throw new Error("Invalid image file");
      bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error("Image changed while reading");
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Image changed while reading");
    } finally { await handle.close(); }
    const identity = createHash("sha256").update(realSource).update(bytes).digest("hex");
    const directory = path.join(managedRunImageDir(runId), identity);
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, path.basename(source));
    await fs.writeFile(target, bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    return { type: "artifact", kind: "image", path: target, metadata: {
      ...metadata, kind: "image", path: target, fileName: path.basename(source), outputRole: "deliverable",
      ...(Array.isArray(input.referenceImagePaths) ? { referenceImagePaths: input.referenceImagePaths.filter((value) => typeof value === "string") } : {}),
    } };
  } catch {
    return { type: "log", level: "warn", message: "Cursor image output could not be displayed.", metadata, ts: Date.now() };
  }
}
