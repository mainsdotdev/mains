import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { MOBILE_OUTPUT_MAX_BYTES, OUTPUT_CHUNK_BYTES, outputFileType, type RunOutput, type RunOutputChunk, type ReadRunOutputPayload } from "@mains/contracts/run-outputs";
import type { RunArtifactResponse } from "./runs.dto";

const revision = (runId: string, id: number, reference: string, identity: unknown) => createHash("sha256").update(JSON.stringify([runId, id, reference, identity])).digest("hex");

export function validateOutputReference(runId: unknown, artifactId?: unknown): asserts runId is string {
  if (typeof runId !== "string" || !runId || runId.length > 256 ||
    artifactId !== undefined && (!Number.isSafeInteger(artifactId) || artifactId === 0)) throw new Error("Invalid conversation output");
}

/** Called only for the service's selected output projection; no caller-supplied path. */
export async function describeRunOutput(runId: string, artifact: RunArtifactResponse, replica: boolean): Promise<RunOutput> {
  const reference = artifact.path ?? artifact.metadata?.path;
  if (typeof reference !== "string") throw new Error("Output file is unavailable");
  const name = path.basename(reference.replace(/\\/g, "/"));
  let byteSize = Number(artifact.metadata?.byteSize);
  let modifiedAt = Number(artifact.metadata?.modifiedAt);
  let identity: unknown = artifact.metadata;
  if (!replica) {
    const stats = await fs.lstat(reference);
    if (!stats.isFile() || stats.isSymbolicLink() || await fs.realpath(reference) !== reference) throw new Error("Output file is unavailable");
    byteSize = stats.size;
    modifiedAt = stats.mtimeMs;
    identity = [stats.size, stats.mtimeMs, stats.ctimeMs, stats.ino, stats.dev];
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > MOBILE_OUTPUT_MAX_BYTES || !Number.isFinite(modifiedAt)) throw new Error("Output file is unavailable or too large");
  const version = revision(runId, artifact.id, reference, identity);
  return { runId, artifactId: artifact.id, name, byteSize, modifiedAt, version, ...outputFileType(name) };
}

/** An original file travels in bounded chunks, with revision and symlink checks on each read. */
export async function readRunOutputChunk(output: RunOutput, sourcePath: string, request: ReadRunOutputPayload, replica: boolean): Promise<RunOutputChunk> {
  if (!Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > output.byteSize ||
    typeof request.version !== "string" || request.version !== output.version) throw new Error("The output changed. Refresh the file and try again.");
  if (await fs.realpath(sourcePath) !== sourcePath) throw new Error("Output file is unavailable");
  const handle = await fs.open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== output.byteSize || !replica && before.mtimeMs !== output.modifiedAt) throw new Error("The output changed. Refresh the file and try again.");
    if (!replica && revision(output.runId, output.artifactId, sourcePath, [before.size, before.mtimeMs, before.ctimeMs, before.ino, before.dev]) !== output.version) throw new Error("The output changed. Refresh the file and try again.");
    const buffer = Buffer.alloc(Math.min(OUTPUT_CHUNK_BYTES, output.byteSize - request.offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, request.offset);
    const after = await handle.stat();
    if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size || bytesRead !== buffer.length) throw new Error("The output changed while downloading. Try again.");
    const next = request.offset + bytesRead;
    return { offset: request.offset, nextOffset: next < output.byteSize ? next : null, byteSize: output.byteSize, version: output.version, base64: buffer.subarray(0, bytesRead).toString("base64") };
  } finally { await handle.close(); }
}
