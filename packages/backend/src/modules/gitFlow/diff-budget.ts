/**
 * Shapes a diff into what a one-shot generation prompt (commit message, PR
 * description) needs: a map of the changed files, then as much of each file's
 * diff as the budget allows.
 *
 * Cutting the raw diff at a character count (the old behaviour) showed the
 * first files in path order and hid the rest, and let a lockfile eat the room
 * the real changes needed. Here the budget is shared out per file instead, and
 * noise files keep their line in the map but give up their hunks.
 *
 * Pure: text in, text out. Reads the same `diff --git` sections that
 * `captureDiffSnapshot` and `git diff` write, synthetic untracked hunks included.
 */

/** One file never takes more than this — a big rewrite mustn't starve the rest. */
const MAX_FILE_CHARS = 6_000;
/** Below this an excerpt says nothing; past it the file is listed without hunks. */
const MIN_FILE_CHARS = 400;
/** The map stays bounded for codemod-sized changesets, and so does the excerpt count. */
const MAX_OVERVIEW_FILES = 100;
/** Room kept per map line for the note it may gain ("— diff not shown (…)"). */
const OVERVIEW_NOTE_CHARS = 40;
/** Room kept per cut file for its "[file diff truncated …]" line. */
const CUT_NOTE_CHARS = 80;
/** Map header and trailer, the blank line before the hunks, and the newlines between them. */
const FRAME_CHARS = 160;

const HEADER = /^diff --git a\/(.+?) b\/(.+)/;
const LOCKFILE = /(\.lock|(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|go\.sum|bun\.lockb|packages\.lock\.json|gradle\.lockfile))$/;
const MINIFIED = /\.(min\.(js|css)|map)$/;
const SNAPSHOT = /(\.snap$|(^|\/)__snapshots__\/)/;

type FileStatus = "A" | "M" | "D" | "R";

interface FileSection {
  path: string;
  oldPath: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  text: string;
  /** Why this file's hunks are left out, when they are. */
  omitted: string | null;
  truncated: boolean;
}

/** Files whose diff tells the model nothing about intent. */
function omittedReason(path: string): string | null {
  if (LOCKFILE.test(path)) return "lockfile";
  if (MINIFIED.test(path)) return "minified or source map";
  if (SNAPSHOT.test(path)) return "test snapshot";
  return null;
}

function parseSection(chunk: string): FileSection | null {
  const header = chunk.match(HEADER);
  if (!header) return null;
  const oldPath = header[1].trim();
  const path = header[2].trim();

  // Everything before the first hunk is git's metadata; hunk lines are always
  // prefixed (' ', '+', '-'), so only the metadata can start with these words.
  const firstHunk = chunk.indexOf("\n@@");
  const meta = firstHunk === -1 ? chunk : chunk.slice(0, firstHunk);
  const status: FileStatus = /^new file/m.test(meta)
    ? "A"
    : /^deleted file/m.test(meta)
      ? "D"
      : /^rename from /m.test(meta)
        ? "R"
        : "M";

  let additions = 0;
  let deletions = 0;
  if (firstHunk !== -1) {
    for (const line of chunk.slice(firstHunk).split("\n")) {
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
  }

  return {
    path,
    oldPath,
    status,
    additions,
    deletions,
    text: chunk.trimEnd(),
    omitted: omittedReason(path),
    truncated: false,
  };
}

const churn = (section: FileSection) => section.additions + section.deletions;

/**
 * Max-min fair split of `total` across files, each capped at `cap`: small files
 * are kept whole and what they leave over goes to the big ones.
 */
function allocate(sizes: number[], cap: number, total: number): number[] {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  const shares = new Array<number>(sizes.length).fill(0);
  let remaining = total;
  order.forEach((index, rank) => {
    const fair = Math.floor(remaining / (order.length - rank));
    shares[index] = Math.min(sizes[index], cap, fair);
    remaining -= shares[index];
  });
  return shares;
}

/** Cut a file's diff at a line boundary, leaving `limit` characters including the note. */
function cutSection(text: string, limit: number): string {
  const head = text.slice(0, Math.max(limit - CUT_NOTE_CHARS, 0));
  const lastBreak = head.lastIndexOf("\n");
  const body = lastBreak > 0 ? head.slice(0, lastBreak) : head;
  return `${body}\n[file diff truncated — showing ${body.length.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")} characters]`;
}

function overviewLine(section: FileSection): string {
  const name =
    section.status === "R"
      ? `${section.oldPath} → ${section.path}`
      : section.path;
  return `${section.status} ${name} (+${section.additions} -${section.deletions})`;
}

/**
 * The diff as the model should read it: a file map followed by the per-file
 * hunks that fit — map included, the result stays within about `totalChars`.
 * Returns null when `diff` has no `diff --git` sections, so the caller can
 * fall back to plain truncation.
 */
export function budgetDiff(
  diff: string,
  totalChars: number,
): string | null {
  const sections = diff
    .split(/^(?=diff --git )/m)
    .map(parseSection)
    .filter((section): section is FileSection => section !== null);
  if (sections.length === 0) return null;

  // Biggest changes first when the room runs out; the output keeps git's order.
  const byChurn = (a: FileSection, b: FileSection) => churn(b) - churn(a);
  const wanted = sections
    .filter((section) => !section.omitted)
    .sort(byChurn)
    .slice(0, MAX_OVERVIEW_FILES);

  // The map lists every file that gets an excerpt, then the biggest of the
  // rest (noise included), so no excerpt ever lacks its line.
  const wantedSet = new Set(wanted);
  const rest = sections.filter((s) => !wantedSet.has(s)).sort(byChurn);
  const listed = new Set([...wanted, ...rest].slice(0, MAX_OVERVIEW_FILES));
  const mapLines = sections.filter((section) => listed.has(section));

  // The map comes off the budget first, so the whole result stays inside it.
  const mapChars = mapLines.reduce(
    (sum, section) =>
      sum + overviewLine(section).length + 1 + OVERVIEW_NOTE_CHARS,
    FRAME_CHARS,
  );
  const hunkChars = Math.max(totalChars - mapChars, MIN_FILE_CHARS);

  const candidates = wanted.slice(0, Math.floor(hunkChars / MIN_FILE_CHARS));
  const shares = allocate(
    candidates.map((section) => section.text.length),
    MAX_FILE_CHARS,
    hunkChars,
  );
  const shown = new Set(candidates);
  candidates.forEach((section, i) => {
    if (shares[i] >= section.text.length) return;
    section.text = cutSection(section.text, shares[i]);
    section.truncated = true;
  });

  const lines = mapLines.map((section) => {
    const note = section.omitted
      ? ` — diff omitted (${section.omitted})`
      : !shown.has(section)
        ? " — diff not shown (too many files)"
        : section.truncated
          ? " — diff truncated"
          : "";
    return `${overviewLine(section)}${note}`;
  });
  if (sections.length > listed.size) {
    lines.push(`… and ${sections.length - listed.size} more files`);
  }

  const hunks = sections
    .filter((section) => shown.has(section))
    .map((section) => section.text);
  return [`Changed files (${sections.length}):`, ...lines, "", ...hunks].join(
    "\n",
  );
}
