import { createHash } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { MOBILE_OUTPUT_MAX_BYTES, outputFileType, type RunOutput, type RunOutputChunk, type ReadRunOutputPayload } from "@mains/contracts/run-outputs";
import type { RunArtifactResponse } from "./runs.dto";
import { readRunFileChunk } from "../../../shared/file-chunks";
export { readRunFileChunk } from "../../../shared/file-chunks";

const revision = (runId: string, id: number, reference: string, identity: unknown) => createHash("sha256").update(JSON.stringify([runId, id, reference, identity])).digest("hex");
export function attachmentFileRevision(runId: string, attachmentId: string, stats: Stats): string {
  return createHash("sha256").update(JSON.stringify([runId, attachmentId, stats.size, stats.mtimeMs, stats.ctimeMs, stats.ino, stats.dev])).digest("hex");
}

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
  return readRunFileChunk(output, sourcePath, request, replica ? undefined : (stats) => revision(output.runId, output.artifactId, sourcePath, [stats.size, stats.mtimeMs, stats.ctimeMs, stats.ino, stats.dev]));
}
