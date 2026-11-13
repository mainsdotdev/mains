import { constants, promises as fs, type Stats } from "node:fs";
import { OUTPUT_CHUNK_BYTES, type RunFileDescriptor, type RunOutputChunk } from "@mains/contracts/run-outputs";

/** Streams an already authorized file, pinned to its descriptor and inode revision. */
export async function readRunFileChunk(output: RunFileDescriptor, sourcePath: string, request: { offset: number; version: string }, fileRevision?: (stats: Stats) => string): Promise<RunOutputChunk> {
  if (!Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > output.byteSize ||
    typeof request.version !== "string" || request.version !== output.version) throw new Error("The output changed. Refresh the file and try again.");
  if (await fs.realpath(sourcePath) !== sourcePath) throw new Error("Output file is unavailable");
  const handle = await fs.open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== output.byteSize || fileRevision && fileRevision(before) !== output.version) throw new Error("The file changed. Refresh the file and try again.");
    const buffer = Buffer.alloc(Math.min(OUTPUT_CHUNK_BYTES, output.byteSize - request.offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, request.offset);
    const after = await handle.stat();
    if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size || bytesRead !== buffer.length) throw new Error("The output changed while downloading. Try again.");
    const next = request.offset + bytesRead;
    return { offset: request.offset, nextOffset: next < output.byteSize ? next : null, byteSize: output.byteSize, version: output.version, base64: buffer.subarray(0, bytesRead).toString("base64") };
  } finally { await handle.close(); }
}
