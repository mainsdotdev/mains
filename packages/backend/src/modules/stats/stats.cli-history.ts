import fs, { type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CliHistorySource } from "./stats.dto";
import { initialCodexState, parseTranscriptLine, type CliProviderId, type CodexTranscriptState, type ConsumptionRecord } from "./stats.transcripts";
import { createStatsWorkBudget } from "./stats.work";

type Source = { providerId: CliProviderId; directories: string[] };
interface CachedFile {
  size: number;
  mtime: number;
  identity: string;
  offset: number;
  guard: Buffer;
  head: Buffer;
  state: CodexTranscriptState;
  records: ConsumptionRecord[];
  skippedLines: number;
  occurrences: Map<string, number>;
}
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const READ_BYTES = 256 * 1024;
const ZSTD_SUFFIX = ".jsonl.zst";

async function* readChunks(handle: FileHandle, position: number, size: number) {
  while (position < size) {
    const buffer = Buffer.allocUnsafe(Math.min(READ_BYTES, size - position));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return;
    yield buffer.subarray(0, bytesRead);
    position += bytesRead;
  }
}

async function* decompressRollout(handle: FileHandle, size: number) {
  if (size === 0) throw new Error("Empty Zstandard rollout");
  const { Zstd } = await import("@hpcc-js/wasm-zstd");
  const decoder = await Zstd.load();
  decoder.resetDecompression();
  // The WASM codec collects each input chunk's output. Small slices bound that
  // allocation even when run-length encoded blocks expand by a large factor.
  const decodeInputBytes = 512;
  for await (const chunk of readChunks(handle, 0, size)) {
    for (let start = 0; start < chunk.length; start += decodeInputBytes) {
      const decoded = decoder.decompressChunk(chunk.subarray(start, start + decodeInputBytes));
      if (decoded.length) yield Buffer.from(decoded);
    }
  }
  decoder.decompressEnd();
}

let pendingCompressedRead = Promise.resolve();
function readCompressed(handle: FileHandle, size: number, consume: (chunks: AsyncIterable<Buffer>) => Promise<void>) {
  // The WASM library shares one decoder across scanner instances. It also
  // validates frame completion consistently across the supported Node versions.
  const result = pendingCompressedRead.then(() => consume(decompressRollout(handle, size)));
  pendingCompressedRead = result.catch(() => undefined);
  return result;
}

export function cliHistorySources(environment = process.env, home = os.homedir()): Source[] {
  const expand = (value: string) => path.resolve(value.startsWith("~/") ? path.join(home, value.slice(2)) : value);
  const claude = expand(environment.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude"));
  const codex = expand(environment.CODEX_HOME?.trim() || path.join(home, ".codex"));
  return [
    { providerId: "claude_code", directories: [path.join(claude, "projects")] },
    { providerId: "codex", directories: [path.join(codex, "sessions"), path.join(codex, "archived_sessions")] },
  ];
}

/** Streaming reads and append offsets keep repeated dashboard scans cheap.
 * Only thin usage records are retained in memory; transcripts stay read-only. */
export function createCliHistoryScanner() {
  const cache = new Map<string, CachedFile>();
  // Serialize walks, including queries for different periods: they share files.
  let pending: Promise<unknown> = Promise.resolve();
  const inFlight = new Map<string, Promise<{ records: ConsumptionRecord[]; sources: CliHistorySource[] }>>();
  const readFile = async (file: string, providerId: CliProviderId) => {
    const handle = await fs.open(file, "r");
    try {
      const compressed = file.endsWith(ZSTD_SUFFIX);
      const stat = await handle.stat();
      const identity = `${providerId}:${stat.dev}:${stat.ino}`;
      const previous = cache.get(file);
      if (previous && previous.identity === identity && previous.size === stat.size && previous.mtime === stat.mtimeMs) return previous;
      let resume = !compressed && previous && previous.identity === identity && stat.size > previous.size ? previous : undefined;
      if (resume) {
        const guard = Buffer.alloc(resume.guard.length);
        const head = Buffer.alloc(resume.head.length);
        const { bytesRead } = await handle.read(guard, 0, guard.length, resume.offset - guard.length);
        const prefix = await handle.read(head, 0, head.length, 0);
        if (bytesRead !== guard.length || !guard.equals(resume.guard)
          || prefix.bytesRead !== head.length || !head.equals(resume.head)) resume = undefined;
      }
      const state = resume ? { ...resume.state } : initialCodexState();
      const records = resume ? [...resume.records] : [];
      const occurrences = new Map(resume?.occurrences);
      const pause = createStatsWorkBudget();
      let skippedLines = resume?.skippedLines ?? 0;
      let offset = resume?.offset ?? 0;
      const fallbackSessionId = compressed ? file.slice(0, -".zst".length) : file;
      const consume = async (input: AsyncIterable<Buffer>) => {
        let position = offset;
        let chunks: Buffer[] = [];
        let lineBytes = 0;
        for await (const buffer of input) {
          let start = 0;
          while (start < buffer.length) {
            const newline = buffer.indexOf(10, start);
            const end = newline < 0 ? buffer.length : newline;
            lineBytes += end - start;
            if (lineBytes > MAX_LINE_BYTES) chunks = [];
            else if (end > start) chunks.push(buffer.subarray(start, end));
            if (newline < 0) break;
            if (lineBytes <= MAX_LINE_BYTES) {
              try {
                const record = parseTranscriptLine(Buffer.concat(chunks).toString("utf8"), providerId, state);
                if (record) {
                  record.sessionId ||= fallbackSessionId;
                  if (providerId === "codex") {
                    // Reconcile moved/copied rollouts once during parsing; equal
                    // genuine events within one file still retain occurrence ids.
                    const key = JSON.stringify([record.providerId, record.sessionId, record.timestamp, record.model,
                      record.inputTokens, record.outputTokens, record.cacheReadTokens, record.cacheWriteTokens]);
                    const occurrence = (occurrences.get(key) ?? 0) + 1;
                    occurrences.set(key, occurrence);
                    record.dedupeKey = `${key}:${occurrence}`;
                  }
                  records.push(record);
                }
              } catch { skippedLines++; }
            } else { skippedLines++; }
            chunks = [];
            lineBytes = 0;
            offset = position + end + 1;
            start = end + 1;
            const yielding = pause();
            if (yielding) await yielding;
          }
          position += buffer.length;
        }
      };
      if (compressed) await readCompressed(handle, stat.size, consume);
      else await consume(readChunks(handle, offset, stat.size));

      // Plain append-only files retry any unfinished tail on the next scan.
      // Compressed rollouts are reused only while the entire file is unchanged.
      const guard = Buffer.alloc(compressed ? 0 : Math.min(4096, offset));
      const head = Buffer.alloc(guard.length);
      if (guard.length) {
        await handle.read(guard, 0, guard.length, offset - guard.length);
        await handle.read(head, 0, head.length, 0);
      }
      const entry = { size: stat.size, mtime: stat.mtimeMs, identity, offset, guard, head, state, records, skippedLines, occurrences };
      cache.set(file, entry);
      return entry;
    } finally { await handle.close(); }
  };

  const scan = async (sources: Source[], fromSeconds: number) => {
    const records: ConsumptionRecord[] = [];
    const statuses: CliHistorySource[] = [];
    const visited = new Set<string>();
    const pause = createStatsWorkBudget();
    for (const source of sources) {
      const status: CliHistorySource = { ...source, status: "missing", scannedFiles: 0, unreadableFiles: 0, skippedLines: 0 };
      let availableDirectories = 0;
      let directoryErrors = 0;
      const directories = new Set<string>();
      const walk = async (directory: string, root = false): Promise<void> => {
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); }
        catch (error) {
          if (!root || (error as NodeJS.ErrnoException).code !== "ENOENT") directoryErrors++;
          return;
        }
        if (root) availableDirectories++;
        for (const entry of entries) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) { await walk(file); continue; }
          const transcript = entry.name.endsWith(".jsonl") ||
            (source.providerId === "codex" && entry.name.endsWith(ZSTD_SUFFIX));
          if (!entry.isFile() || !transcript || visited.has(file)) continue;
          visited.add(file);
          try {
            const stat = await fs.stat(file);
            // Files may predate local midnight by any supported UTC offset.
            if (stat.mtimeMs < fromSeconds * 1000 - 36 * 60 * 60 * 1000) continue;
            const cached = cache.get(file);
            const parsed = cached && cached.identity === `${source.providerId}:${stat.dev}:${stat.ino}`
              && cached.size === stat.size && cached.mtime === stat.mtimeMs ? cached : await readFile(file, source.providerId);
            status.scannedFiles++;
            status.skippedLines += parsed.skippedLines;
            for (const record of parsed.records) {
              if (record.timestamp >= fromSeconds) records.push(record);
              const yielding = pause();
              if (yielding) await yielding;
            }
          } catch { status.unreadableFiles++; }
        }
      };
      for (const directory of source.directories) {
        const canonical = await fs.realpath(directory).catch(() => directory);
        if (directories.has(canonical)) continue;
        directories.add(canonical);
        await walk(canonical, true);
      }
      status.unreadableFiles += directoryErrors;
      status.status = availableDirectories === 0 ? directoryErrors > 0 ? "error" : "missing"
        : status.unreadableFiles > 0 || status.skippedLines > 0 ? "partial" : "available";
      statuses.push(status);
    }
    const scannedProviders = new Set(sources.map((source) => source.providerId));
    for (const [file, entry] of cache) {
      if (scannedProviders.has(entry.identity.split(":")[0] as CliProviderId) && !visited.has(file)) cache.delete(file);
    }
    return { records, sources: statuses };
  };
  return { read(sources = cliHistorySources(), fromSeconds = 0) {
    const key = JSON.stringify([sources, fromSeconds]);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const result = pending.then(() => scan(sources, fromSeconds)).finally(() => { inFlight.delete(key); });
    inFlight.set(key, result);
    pending = result.catch(() => undefined);
    return result;
  } };
}

export const cliHistoryScanner = createCliHistoryScanner();
