/**
 * Reading a tool call's input and output on the phone.
 *
 * The desktop's per-tool displays each carry their own parser for the shape
 * their provider emits (`structuredPatch` from Claude, `detailedContent` from
 * Copilot, a bare stdout string from a shell, …). Those parsers are the part
 * worth porting verbatim — the shapes are the wire, not the UI — so they live
 * here, decoupled from the components that render them.
 *
 * Everything is defensive: a payload we don't recognize degrades to pretty
 * JSON rather than an empty row.
 */

/** `tool_calls.input_json` → params object, or `{}`. */
export function parseToolInput(inputJson: string | null): Record<string, unknown> {
  if (!inputJson) return {};
  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // Copilot's apply_patch sends a bare `*** Begin Patch …` string.
    if (typeof parsed === "string") return { _raw: parsed };
  } catch {
    /* fall through */
  }
  return {};
}

/**
 * `tool_calls.output_json` → the value the Mac recorded. The column is a
 * `JSON.stringify` of whatever the driver captured, and drivers often capture
 * a *string* that is itself JSON — so unwrap twice.
 */
export function coerceToolOutput(outputJson: string | null): unknown {
  if (!outputJson) return null;
  let value: unknown;
  try {
    value = JSON.parse(outputJson);
  } catch {
    return outputJson;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Flatten any tool result to renderable text: a bare string, an Anthropic
 * content-block array, an MCP `{ content: [...] }` envelope, else pretty JSON.
 */
export function toolOutputText(output: unknown): string {
  if (output === null || output === undefined) return "";
  if (typeof output === "string") return output.trim();

  const collected = collectText(output).join("\n").trim();
  if (collected) return collected;

  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return "";
  }
}

function collectText(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.content !== undefined) return collectText(obj.content);
    if (typeof obj.text === "string") return [obj.text];
  }
  return [];
}

/** CSI escape sequences, so a colored shell log reads as plain text. */
const ANSI_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Shell output, stripped of escape codes and collapsed blank runs. */
export function parseShellOutput(output: unknown): string | null {
  if (typeof output === "string") return stripAnsi(output);
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    const body = str(obj.stdout) ?? str(obj.content) ?? str(obj.output);
    if (body) return stripAnsi(body);
  }
  const text = toolOutputText(output);
  return text ? stripAnsi(text) : null;
}

function stripAnsi(input: string): string {
  return input
    .replace(ANSI_REGEX, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Read's file body plus its line count — `{ file: { content } }` or flat. */
export function parseReadOutput(output: unknown): { content: string | null; numLines: number } {
  if (typeof output === "string") {
    return { content: output, numLines: output.split("\n").length };
  }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    if (obj.file && typeof obj.file === "object") {
      const file = obj.file as Record<string, unknown>;
      const content = str(file.content);
      return { content, numLines: num(file.numLines) || (content ? content.split("\n").length : 0) };
    }
    const content = str(obj.content);
    if (content) {
      return { content, numLines: num(obj.numLines) || content.split("\n").length };
    }
  }
  const text = toolOutputText(output);
  return text ? { content: text, numLines: text.split("\n").length } : { content: null, numLines: 0 };
}

export interface GrepSummary {
  content: string | null;
  numFiles: number;
  numLines: number;
  totalMatches: number;
  truncated: boolean;
}

/** Grep / ripgrep results plus the counts the header shows in parentheses. */
export function parseGrepOutput(output: unknown): GrepSummary {
  const empty: GrepSummary = {
    content: null,
    numFiles: 0,
    numLines: 0,
    totalMatches: 0,
    truncated: false,
  };
  if (typeof output === "string") {
    return { ...empty, content: output, numLines: output.split("\n").length };
  }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    const filenames = Array.isArray(obj.filenames) ? (obj.filenames as string[]) : [];
    const content = str(obj.content) ?? (filenames.length > 0 ? filenames.join("\n") : null);
    return {
      content,
      numFiles: num(obj.numFiles) || num(obj.totalFiles) || filenames.length,
      numLines: num(obj.numLines),
      totalMatches: num(obj.totalMatches),
      truncated: obj.truncated === true,
    };
  }
  const text = toolOutputText(output);
  return text ? { ...empty, content: text, numLines: text.split("\n").length } : empty;
}

/** Glob results: the matched paths and how many there were. */
export function parseGlobOutput(output: unknown): { files: string[]; truncated: boolean } {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    const list = Array.isArray(obj.filenames)
      ? obj.filenames
      : Array.isArray(obj.files)
        ? obj.files
        : null;
    if (list) {
      return {
        files: list.filter((f): f is string => typeof f === "string"),
        truncated: obj.truncated === true,
      };
    }
  }
  if (Array.isArray(output)) {
    return { files: output.filter((f): f is string => typeof f === "string"), truncated: false };
  }
  const text = toolOutputText(output);
  return {
    files: text ? text.split("\n").filter(Boolean) : [],
    truncated: false,
  };
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  text: string;
  /** Position before the change; null on an added line, or when the source names no positions. */
  oldNo: number | null;
  /** Position after the change; null on a removed line, or when the source names no positions. */
  newNo: number | null;
}

/** One contiguous stretch of a patch; the lines between two hunks were left out. */
export interface DiffHunk {
  lines: DiffLine[];
}

export interface Diff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

const EMPTY_DIFF: Diff = { hunks: [], added: 0, removed: 0 };

/**
 * The diff an Edit / Write / apply_patch produced. Four sources, in the order
 * the desktop trusts them: Claude's `structuredPatch`, Copilot's
 * `detailedContent` unified diff, a raw `*** Begin Patch` envelope on the
 * input, and finally the tool's own `old_string` / `new_string` params.
 */
export function parseDiff(output: unknown, params: Record<string, unknown>): Diff {
  const structured = structuredPatchDiff(output);
  if (structured) return structured;

  const unified = unifiedDiff(output);
  if (unified) return unified;

  const envelope = str(params._raw) ?? str(params.patch) ?? str(params.input);
  if (envelope && envelope.includes("*** Begin Patch")) {
    return patchEnvelopeDiff(envelope) ?? EMPTY_DIFF;
  }

  const before = str(params.old_string) ?? str(params.old_str);
  const after = str(params.new_string) ?? str(params.new_str);
  if (before || after) {
    // The params say what changed but not where, so the lines stay unnumbered.
    const diff = createDiffBuilder();
    if (before) diff.push(`-${before}`);
    if (after) diff.push(`+${after}`);
    return diff.finish() ?? EMPTY_DIFF;
  }

  return EMPTY_DIFF;
}

/** A file written from nothing: every line an addition, numbered from 1. */
export function newFileDiff(content: string): Diff {
  const diff = createDiffBuilder();
  diff.startHunk(0, 1);
  for (const line of splitLines(content)) diff.push(`+${line}`);
  return diff.finish() ?? EMPTY_DIFF;
}

/**
 * How many lines a patch left out between two hunks, or null when the hunks
 * carry no positions to tell.
 */
export function linesBetween(previous: DiffHunk, next: DiffHunk): number | null {
  for (const key of ["newNo", "oldNo"] as const) {
    let end: number | null = null;
    for (const line of previous.lines) end = line[key] ?? end;
    const start = next.lines.find((line) => line[key] !== null)?.[key] ?? null;
    if (end !== null && start !== null) return Math.max(0, start - end - 1);
  }
  return null;
}

/**
 * Accumulates prefixed patch lines (`+`, `-`, ` `) into numbered hunks. A hunk
 * started without positions keeps its lines unnumbered rather than counting
 * from a made-up 1.
 */
function createDiffBuilder() {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo: number | null = null;
  let newNo: number | null = null;
  let added = 0;
  let removed = 0;

  const startHunk = (oldStart: number | null, newStart: number | null): DiffHunk => {
    current = { lines: [] };
    hunks.push(current);
    oldNo = oldStart;
    newNo = newStart;
    return current;
  };

  const push = (raw: string) => {
    // `\ No newline at end of file` annotates the line before it; it is not content.
    if (raw.startsWith("\\")) return;
    const hunk = current ?? startHunk(null, null);
    const prefix = raw[0];
    const type = prefix === "+" ? "add" : prefix === "-" ? "remove" : "context";
    const body = prefix === "+" || prefix === "-" || prefix === " " ? raw.slice(1) : raw;
    // One entry can carry several physical lines (Claude's structuredPatch,
    // old_string); each one is its own row.
    for (const text of body.split("\n")) {
      hunk.lines.push({
        type,
        text,
        oldNo: type === "add" ? null : oldNo,
        newNo: type === "remove" ? null : newNo,
      });
      if (type !== "add" && oldNo !== null) oldNo++;
      if (type !== "remove" && newNo !== null) newNo++;
      if (type === "add") added++;
      else if (type === "remove") removed++;
    }
  };

  const finish = (): Diff | null => {
    const filled = hunks.filter((hunk) => hunk.lines.length > 0);
    return filled.length > 0 ? { hunks: filled, added, removed } : null;
  };

  return { startHunk, push, finish };
}

function structuredPatchDiff(output: unknown): Diff | null {
  if (!output || typeof output !== "object") return null;
  const sp = (output as Record<string, unknown>).structuredPatch;
  if (!Array.isArray(sp)) return null;
  const diff = createDiffBuilder();
  for (const entry of sp) {
    if (!entry || typeof entry !== "object") continue;
    const hunk = entry as Record<string, unknown>;
    if (!Array.isArray(hunk.lines)) continue;
    diff.startHunk(lineNumber(hunk.oldStart), lineNumber(hunk.newStart));
    for (const line of hunk.lines) diff.push(typeof line === "string" ? line : String(line));
  }
  return diff.finish();
}

function unifiedDiff(output: unknown): Diff | null {
  if (!output || typeof output !== "object") return null;
  const content = str((output as Record<string, unknown>).detailedContent);
  if (!content) return null;

  const looksUnified =
    content.startsWith("--- ") || content.startsWith("diff ") || content.startsWith("@@");
  // A whole new file — every line is an addition.
  if (!looksUnified) return newFileDiff(content);

  const diff = createDiffBuilder();
  let inHunk = false;
  for (const line of splitLines(content)) {
    if (line.startsWith("@@")) {
      const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      diff.startHunk(header ? Number(header[1]) : null, header ? Number(header[2]) : null);
      inHunk = true;
      continue;
    }
    if (line.startsWith("diff ")) {
      inHunk = false;
      continue;
    }
    // File headers only precede a hunk; inside one, `--- x` is a removed `-- x`.
    if (!inHunk && (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ "))) {
      continue;
    }
    diff.push(line);
  }
  return diff.finish();
}

/** The body of a `*** Begin Patch … *** End Patch` envelope. It names no positions. */
function patchEnvelopeDiff(envelope: string): Diff | null {
  const diff = createDiffBuilder();
  for (const line of envelope.split("\n")) {
    if (line.startsWith("***") || line.startsWith("@@")) {
      diff.startHunk(null, null);
    } else if (line !== "") {
      diff.push(line);
    }
  }
  return diff.finish();
}

/** Lines of a text body, without the empty one a trailing newline leaves. */
function splitLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lineNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The file a file-touching tool acted on, under any provider's param name. */
export function toolFilePath(params: Record<string, unknown>): string {
  return str(params.file_path) ?? str(params.path) ?? str(params.filePath) ?? "";
}

/** Collapse a deep path to its file name; shallow paths pass through whole. */
export function shortFileName(fullPath: string): string {
  const parts = fullPath.split("/");
  return parts.length > 3 ? parts[parts.length - 1] : fullPath;
}

/** Abbreviate a deep path to its last three segments. */
export function shortPath(fullPath: string): string {
  const parts = fullPath.split("/");
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : fullPath;
}

/**
 * The one line a tool row shows beside its verb — the param that carries the
 * gist, in the order the desktop's displays reach for it.
 */
const PREVIEW_KEYS = [
  "command",
  "description",
  "file_path",
  "path",
  "pattern",
  "query",
  "regex",
  "url",
  "skill",
  "prompt",
  "intent",
  "question",
  "name",
];

export function toolSummary(params: Record<string, unknown>, max = 120): string {
  for (const key of PREVIEW_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0) return truncate(value, max);
  }
  const first = Object.values(params).find((v) => typeof v === "string" && v.length > 0);
  return typeof first === "string" ? truncate(first, max) : "";
}

function truncate(value: string, max: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
