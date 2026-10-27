import { and, eq } from "drizzle-orm";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import type { ReadRunOutputPayload, RunOutput, RunOutputChunk } from "@mains/contracts/run-outputs";

import { projectionDb as db, projectionTransaction, runProjectionWrite } from "@/db/client";
import { runOutputs } from "@/db/schema";
import { checkDownloadSignal, downloadOutput, outputCacheSegment, outputCacheSegments } from "@/lib/output-download";

const root = new Directory(Paths.cache, "mains-outputs");
const downloads = new Map<string, Set<AbortController>>();
/** Which run each in-flight download belongs to, so forgetting one run cancels only its own. */
const downloadRuns = new WeakMap<AbortController, string>();
const pins = new Map<string, number>();
const cacheLimit = 200 * 1024 * 1024;
const whereOutput = (backendId: string, runId: string, artifactId: number) => and(eq(runOutputs.backendId, backendId), eq(runOutputs.runId, runId), eq(runOutputs.artifactId, artifactId));

export function pinOutputFile(uri: string): () => void {
  pins.set(uri, (pins.get(uri) ?? 0) + 1);
  return () => { const count = (pins.get(uri) ?? 1) - 1; if (count) pins.set(uri, count); else pins.delete(uri); };
}

export function rememberOutputs(backendId: string, outputs: readonly RunOutput[]): void {
  projectionTransaction(() => {
    for (const output of outputs) {
      const previous = db.select().from(runOutputs).where(whereOutput(backendId, output.runId, output.artifactId)).get();
      const data = { descriptorJson: JSON.stringify(output), version: output.version, localUri: previous?.version === output.version ? previous.localUri : null };
      runProjectionWrite(runOutputs, () => db.insert(runOutputs).values({ backendId, runId: output.runId, artifactId: output.artifactId, ...data })
        .onConflictDoUpdate({ target: [runOutputs.backendId, runOutputs.runId, runOutputs.artifactId], set: data }).run());
    }
  });
}

export function cachedOutput(backendId: string, runId: string, artifactId: number): { output: RunOutput; uri: string | null } | null {
  const row = db.select().from(runOutputs).where(whereOutput(backendId, runId, artifactId)).get();
  if (!row) return null;
  try {
    const output = JSON.parse(row.descriptorJson) as RunOutput;
    const expected = new File(root, ...outputCacheSegments(backendId, output));
    return { output, uri: row.localUri === expected.uri && expected.exists && expected.size === output.byteSize ? expected.uri : null };
  } catch { return null; }
}

function pruneCache(except: string): void {
  if (!root.exists) return;
  const children = (directory: Directory, depth = 0): File[] => depth > 3 ? [] : directory.list().flatMap((entry) => entry instanceof File ? [entry] : children(entry, depth + 1));
  const files = children(root);
  let bytes = files.reduce((total, file) => total + file.size, 0);
  for (const file of files.sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))) {
    if (file.uri === except || pins.has(file.uri)) continue;
    if (bytes <= cacheLimit && !file.name.startsWith(".part-")) continue;
    bytes -= file.size;
    file.delete();
    runProjectionWrite(runOutputs, () => db.update(runOutputs).set({ localUri: null }).where(eq(runOutputs.localUri, file.uri)).run());
  }
}

export async function ensureOutputFile(backendId: string, output: RunOutput, read: (request: ReadRunOutputPayload) => Promise<RunOutputChunk>, signal: AbortSignal, onProgress?: (received: number) => void): Promise<string> {
  checkDownloadSignal(signal);
  const cached = cachedOutput(backendId, output.runId, output.artifactId);
  if (cached?.uri && cached.output.version === output.version) return cached.uri;
  const [backend, run, revision, name] = outputCacheSegments(backendId, output);
  const directory = new Directory(root, backend, run, revision);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, name);
  const temporary = new File(directory, `.part-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  temporary.create();
  const writer = temporary.open(FileMode.WriteOnly);
  const controller = new AbortController();
  downloadRuns.set(controller, output.runId);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  const active = downloads.get(backendId) ?? new Set<AbortController>();
  active.add(controller);
  downloads.set(backendId, active);
  const unpin = pinOutputFile(temporary.uri);
  try {
    if (signal.aborted) controller.abort();
    await downloadOutput({ output, read, signal: controller.signal, write: (bytes) => writer.writeBytes(bytes), onProgress });
    writer.close();
    checkDownloadSignal(controller.signal);
    if (temporary.size !== output.byteSize) throw new Error("Incomplete download. Try again.");
    if (destination.exists && destination.size === output.byteSize) temporary.delete();
    else { if (destination.exists) destination.delete(); temporary.move(destination); }
    rememberOutputs(backendId, [output]);
    runProjectionWrite(runOutputs, () => db.update(runOutputs).set({ localUri: destination.uri, lastOpenedAt: new Date() }).where(whereOutput(backendId, output.runId, output.artifactId)).run());
    try { pruneCache(destination.uri); } catch { /* Cache maintenance must not hide a downloaded file. */ }
    return destination.uri;
  } finally {
    try { writer.close(); } catch { /* Already closed or canceled. */ }
    try { if (temporary.exists && temporary.uri !== destination.uri) temporary.delete(); } catch { /* Forgetting a backend may already remove its directory. */ }
    unpin();
    active.delete(controller);
    if (!active.size) downloads.delete(backendId);
    signal.removeEventListener("abort", abort);
  }
}

/**
 * A conversation deleted on the Mac takes its downloaded files with it: rows,
 * cached copies and any download still running. One that only left the
 * phone's window keeps them for when it comes back.
 */
export function forgetRunOutputs(backendId: string, runId: string): void {
  for (const controller of downloads.get(backendId) ?? []) {
    if (downloadRuns.get(controller) === runId) controller.abort();
  }
  runProjectionWrite(runOutputs, () => db.delete(runOutputs)
    .where(and(eq(runOutputs.backendId, backendId), eq(runOutputs.runId, runId))).run());
  try {
    const directory = new Directory(root, outputCacheSegment(backendId), outputCacheSegment(runId));
    if (directory.exists) directory.delete();
  } catch { /* No cache directory can exist for an identity the cache refuses. */ }
}

export function clearOutputCache(backendId: string): void {
  for (const controller of downloads.get(backendId) ?? []) controller.abort();
  const directory = new Directory(root, `id-${encodeURIComponent(backendId)}`);
  if (directory.exists) directory.delete();
}
