import type { RunHistoryContentPage } from "@mains/contracts/runs";
import type { Diff, DiffHunk } from "./tool-output";

const PAGE_LINES = 160;
const PAGE_CHARS = 32_768;
const LINE_CHARS = 16_384;

/** A bookmark in the stored patch, using SQLite's Unicode character offsets. */
export interface FileDiffCursor {
  offset: number;
  selected: boolean;
  oldNo: number;
  newNo: number;
  oldLeft: number;
  newLeft: number;
}

export interface FileDiffPage {
  diff: Diff;
  found: boolean;
  binary: boolean;
  shortened: boolean;
  next: FileDiffCursor | null;
}

/** Git quotes control characters and, by default, UTF-8 bytes as C octal escapes. */
function unquotePath(raw: string): string | undefined {
  if (!raw.startsWith('"')) return raw;
  if (!raw.endsWith('"')) return undefined;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escapes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, "\\": 92 };
  let end = 0;
  for (const match of body.matchAll(/\\([0-7]{1,3}|.)/g)) {
    bytes.push(...encoder.encode(body.slice(end, match.index)));
    const value = /^[0-7]+$/.test(match[1]) ? parseInt(match[1], 8) : escapes[match[1]];
    if (value === undefined) return undefined;
    bytes.push(value);
    end = match.index + match[0].length;
  }
  bytes.push(...encoder.encode(body.slice(end)));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function matchesFile(header: string, path: string, oldPath: string): boolean {
  const raw = header.slice("diff --git ".length);
  // An unquoted name may contain spaces, so use the known old path as its boundary.
  const left = raw.startsWith('"') ? raw.match(/^"(?:\\.|[^"\\])*"/)?.[0] : `a/${oldPath}`;
  if (!left || !raw.startsWith(`${left} `)) return false;
  return unquotePath(left) === `a/${oldPath}` && unquotePath(raw.slice(left.length + 1)) === `b/${path}`;
}

/** Keep only one wire chunk and one bounded line, including while skipping huge binaries. */
class PatchLines {
  private pending = "";
  private remoteOffset: number | null;
  private position: number;
  private read: (offset: number) => Promise<RunHistoryContentPage>;
  private active: () => boolean;

  constructor(
    offset: number,
    read: (offset: number) => Promise<RunHistoryContentPage>,
    active: () => boolean,
  ) {
    this.remoteOffset = this.position = offset;
    this.read = read;
    this.active = active;
  }

  async next(): Promise<{ text: string; offset: number; nextOffset: number; shortened: boolean } | null> {
    const offset = this.position;
    let text = "", shortened = false, consumed = false;
    while (true) {
      if (!this.active()) throw new Error("Diff loading cancelled");
      if (!this.pending) {
        if (this.remoteOffset === null) break;
        const requested = this.remoteOffset;
        const page = await this.read(requested);
        if (!this.active()) throw new Error("Diff loading cancelled");
        if (typeof page.text !== "string" || page.offset !== requested || (page.nextOffset !== null &&
          (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= requested))) throw new Error("Could not read this stored diff");
        this.pending = page.text;
        this.remoteOffset = page.nextOffset;
        if (!this.pending && this.remoteOffset !== null) throw new Error("Could not read this stored diff");
      }
      const newline = this.pending.indexOf("\n");
      const take = newline < 0 ? this.pending.length : newline + 1;
      const part = this.pending.slice(0, take);
      this.pending = this.pending.slice(take);
      this.position += Array.from(part).length;
      consumed ||= part.length > 0;
      const remaining = Math.max(0, LINE_CHARS - text.length);
      text += part.slice(0, remaining);
      shortened ||= part.length > remaining;
      if (newline >= 0) break;
    }
    return consumed ? { text: text.replace(/\r?\n$/, ""), offset, nextOffset: this.position, shortened } : null;
  }
}

/** Read just one file's numbered diff page; never accumulate the turn's full patch. */
export async function readTurnFileDiff({
  path, oldPath = path, cursor, read, active = () => true,
}: {
  path: string;
  oldPath?: string;
  cursor?: FileDiffCursor;
  read: (offset: number) => Promise<RunHistoryContentPage>;
  active?: () => boolean;
}): Promise<FileDiffPage> {
  const state: FileDiffCursor = cursor ? { ...cursor } : { offset: 0, selected: false, oldNo: 0, newNo: 0, oldLeft: 0, newLeft: 0 };
  const source = new PatchLines(state.offset, read, active);
  const result: FileDiffPage = { diff: { hunks: [], added: 0, removed: 0 }, found: state.selected, binary: false, shortened: false, next: null };
  let current: DiffHunk | null = null, lineCount = 0, chars = 0;
  for (let line = await source.next(); line; line = await source.next()) {
    if (line.text.startsWith("diff --git ")) {
      if (state.selected) return result;
      state.selected = !line.shortened && matchesFile(line.text, path, oldPath);
      result.found = state.selected;
      continue;
    }
    if (!state.selected) continue;
    if (line.text === "GIT binary patch" || /^Binary files .* differ$/.test(line.text)) {
      result.binary = true;
      return result;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line.text);
    if (hunk) {
      state.oldNo = Number(hunk[1]); state.oldLeft = Number(hunk[2] ?? 1);
      state.newNo = Number(hunk[3]); state.newLeft = Number(hunk[4] ?? 1);
      current = null;
      continue;
    }
    const prefix = line.text[0];
    if (state.oldLeft === 0 && state.newLeft === 0) continue;
    if (prefix !== "+" && prefix !== "-" && prefix !== " ") continue;
    if (lineCount >= PAGE_LINES || chars >= PAGE_CHARS) {
      result.next = { ...state, offset: line.offset };
      return result;
    }
    const type = prefix === "+" ? "add" : prefix === "-" ? "remove" : "context";
    if (!current) { current = { lines: [] }; result.diff.hunks.push(current); }
    current.lines.push({ type, text: line.text.slice(1) + (line.shortened ? "…" : ""),
      oldNo: type === "add" ? null : state.oldNo, newNo: type === "remove" ? null : state.newNo });
    if (type !== "add") { state.oldNo++; state.oldLeft--; }
    if (type !== "remove") { state.newNo++; state.newLeft--; }
    if (type === "add") result.diff.added++;
    if (type === "remove") result.diff.removed++;
    result.shortened ||= line.shortened;
    chars += line.text.length;
    lineCount++;
  }
  return result;
}
