import { spawn } from "node:child_process";
import * as path from "node:path";
import { createInterface } from "node:readline";
import type {
  TextSearchFileMatch,
  TextSearchLineMatch,
  TextSearchRange,
  TextSearchResult,
} from "@mains/contracts/text-search";
import {
  DEFAULT_SEARCH_EXCLUDE_PATTERNS,
  MAX_FILE_SIZE_BYTES,
} from "./fileExplorer.dto";

// ─────────────────────────────────────────────────────────────
// Text search
//
// Content search runs ripgrep, the same binary VS Code ships, from
// @vscode/ripgrep's per-platform package. ripgrep walks the tree itself, so
// .gitignore applies inside a git repository and binary files are skipped
// without any work here. Its `--json` output is read line by line and folded
// into per-file results; offsets arrive as UTF-8 byte positions and leave as
// UTF-16 ones, which is what the renderer and the editor index strings by.
// ─────────────────────────────────────────────────────────────

export const DEFAULT_TEXT_SEARCH_MAX_RESULTS = 2_000;
export const MAX_TEXT_SEARCH_RESULTS = 10_000;
export const MAX_TEXT_SEARCH_QUERY_LENGTH = 1_000;
// A search that outlives this is cut short and reported as truncated.
const TEXT_SEARCH_TIMEOUT_MS = 20_000;
// Characters kept ahead of a line's first match when its preview is cut.
const PREVIEW_LEAD_CHARS = 24;
const PREVIEW_MAX_CHARS = 240;
const MAX_STDERR_CHARS = 4_096;

let ripgrepPath: string | undefined;

/**
 * Locate the ripgrep binary. The import is lazy so a missing platform package
 * breaks content search alone, never backend start-up. In a packaged app the
 * package resolves inside app.asar, which child_process cannot execute from;
 * forge unpacks the binary beside the archive (`**\/rg` in forge.config.js),
 * so the path is pointed there.
 */
async function resolveRipgrepPath(): Promise<string> {
  if (!ripgrepPath) {
    const { rgPath } = await import("@vscode/ripgrep");
    ripgrepPath = rgPath.replace(
      /([\\/])app\.asar([\\/])/,
      "$1app.asar.unpacked$2",
    );
  }
  return ripgrepPath;
}

export interface RipgrepSearchOptions {
  rootPath: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeHidden: boolean;
}

export function buildRipgrepArgs(options: RipgrepSearchOptions): string[] {
  const args = [
    "--json",
    // A user's RIPGREP_CONFIG_PATH must not change what the explorer finds.
    "--no-config",
    // Past this size the editor can't open the file anyway.
    "--max-filesize",
    String(MAX_FILE_SIZE_BYTES),
    options.caseSensitive ? "--case-sensitive" : "--ignore-case",
  ];
  if (!options.regex) args.push("--fixed-strings");
  if (options.wholeWord) args.push("--word-regexp");
  if (options.includeHidden) args.push("--hidden");
  // Outside a git repository nothing else keeps node_modules out.
  for (const pattern of DEFAULT_SEARCH_EXCLUDE_PATTERNS) {
    args.push("--glob", `!${pattern}`);
  }
  // `--regexp` keeps a query that starts with "-" from reading as a flag;
  // `--` does the same for the path.
  args.push("--regexp", options.query, "--", options.rootPath);
  return args;
}

/** ripgrep writes valid UTF-8 as `text` and anything else base64-encoded. */
interface RipgrepData {
  text?: string;
  bytes?: string;
}

function dataToBuffer(data: RipgrepData): Buffer {
  return data.text !== undefined
    ? Buffer.from(data.text, "utf8")
    : Buffer.from(data.bytes ?? "", "base64");
}

function dataToText(data: RipgrepData): string {
  return data.text ?? Buffer.from(data.bytes ?? "", "base64").toString("utf8");
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Turn one ripgrep match message into a line match: byte offsets become
 * UTF-16 offsets, the line ending and indentation go, and a match far into
 * the line gets a window that starts shortly before it.
 */
export function toLineMatch(
  lineBytes: Buffer,
  lineNumber: number,
  submatches: ReadonlyArray<{ start: number; end: number }>,
): TextSearchLineMatch {
  const decoded = lineBytes.toString("utf8");
  const text = decoded.replace(/\r?\n$/, "");
  // One byte per character means the line is ASCII: offsets already agree.
  const ascii = lineBytes.length === decoded.length;
  const toOffset = (byteOffset: number) =>
    Math.min(
      text.length,
      ascii
        ? byteOffset
        : lineBytes.subarray(0, byteOffset).toString("utf8").length,
    );
  const ranges: TextSearchRange[] = submatches
    .map((submatch) => ({
      start: toOffset(submatch.start),
      end: toOffset(submatch.end),
    }))
    .filter((range) => range.end > range.start);

  const firstStart = ranges[0]?.start ?? 0;
  // Indentation says nothing in a one-line preview.
  let previewStart = 0;
  while (
    previewStart < firstStart &&
    (text[previewStart] === " " || text[previewStart] === "\t")
  ) {
    previewStart++;
  }
  const previewClipped = firstStart - previewStart > PREVIEW_LEAD_CHARS;
  if (previewClipped) {
    previewStart = firstStart - PREVIEW_LEAD_CHARS;
    if (isLowSurrogate(text.charCodeAt(previewStart))) previewStart--;
  }
  let previewEnd = Math.min(text.length, previewStart + PREVIEW_MAX_CHARS);
  if (previewEnd < text.length && isLowSurrogate(text.charCodeAt(previewEnd))) {
    previewEnd--;
  }

  return {
    line: lineNumber,
    preview: text.slice(previewStart, previewEnd),
    previewStart,
    previewClipped,
    ranges,
  };
}

/** The error a ripgrep run that died before searching anything reports. */
export function describeRipgrepFailure(stderr: string): Error {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (stderr.includes("regex parse error")) {
    const reason = lines
      .find((line) => line.startsWith("error:"))
      ?.slice("error:".length)
      .trim();
    return new Error(
      reason ? `Invalid regular expression: ${reason}` : "Invalid regular expression",
    );
  }
  const first = lines[0]?.replace(/^rg:\s*/, "");
  return new Error(first ? `Search failed: ${first}` : "Search failed");
}

const inFlight = new Map<string, AbortController>();

/**
 * Cancel the search running under `cancelKey` and register the one starting
 * now. `release` drops the registration once that search settles.
 */
export function takeOverTextSearch(cancelKey: string | undefined): {
  signal: AbortSignal;
  release: () => void;
} {
  const controller = new AbortController();
  if (!cancelKey) return { signal: controller.signal, release: () => {} };
  inFlight.get(cancelKey)?.abort();
  inFlight.set(cancelKey, controller);
  return {
    signal: controller.signal,
    release: () => {
      if (inFlight.get(cancelKey) === controller) inFlight.delete(cancelKey);
    },
  };
}

interface RipgrepMatchMessage {
  type: "match";
  data: {
    path: RipgrepData;
    lines: RipgrepData;
    line_number: number | null;
    submatches: Array<{ start: number; end: number }>;
  };
}

/** Run ripgrep under `options.rootPath` and collect up to `maxResults` lines. */
export async function runTextSearch(
  options: RipgrepSearchOptions & { maxResults: number },
  signal?: AbortSignal,
): Promise<TextSearchResult> {
  if (signal?.aborted) return { files: [], matchCount: 0, truncated: true };

  let binary: string;
  try {
    binary = await resolveRipgrepPath();
  } catch (error) {
    console.error("[FileExplorer] ripgrep is not available:", error);
    throw new Error("Text search is unavailable: ripgrep is not installed");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(binary, buildRipgrepArgs(options), {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const files = new Map<string, TextSearchFileMatch>();
    let lineCount = 0;
    let matchCount = 0;
    let truncated = false;
    // ripgrep closes a finished search with a summary message; a run that
    // dies on its arguments (a bad regex) never gets that far.
    let completed = false;
    let settled = false;
    let stderr = "";

    const stop = () => {
      if (truncated) return;
      truncated = true;
      child.kill();
    };
    const timer = setTimeout(stop, TEXT_SEARCH_TIMEOUT_MS);
    signal?.addEventListener("abort", stop, { once: true });
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    };

    createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
      "line",
      (raw) => {
        if (truncated) return;
        let message: { type?: string };
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }
        if (message.type === "summary") {
          completed = true;
          return;
        }
        if (message.type !== "match") return;

        const { data } = message as RipgrepMatchMessage;
        const lineMatch = toLineMatch(
          dataToBuffer(data.lines),
          data.line_number ?? 0,
          data.submatches,
        );
        if (lineMatch.ranges.length === 0) return;

        const fullPath = dataToText(data.path);
        let file = files.get(fullPath);
        if (!file) {
          file = {
            fullPath,
            relativePath: path
              .relative(options.rootPath, fullPath)
              .split(path.sep)
              .join("/"),
            lines: [],
          };
          files.set(fullPath, file);
        }
        file.lines.push(lineMatch);
        lineCount++;
        matchCount += lineMatch.ranges.length;
        if (lineCount >= options.maxResults) stop();
      },
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) return;
      finish();
      console.error("[FileExplorer] ripgrep failed to start:", error);
      reject(new Error("Text search is unavailable: ripgrep could not start"));
    });

    child.on("close", (code) => {
      if (settled) return;
      finish();
      // Exit 2 after a summary means some files could not be read; the rest
      // of the results stand.
      if (code === 2 && !completed && !truncated) {
        reject(describeRipgrepFailure(stderr));
        return;
      }
      if (stderr) console.warn("[FileExplorer] ripgrep:", stderr.trim());
      resolve({
        files: [...files.values()].sort((a, b) =>
          a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
        ),
        matchCount,
        truncated,
      });
    });
  });
}
