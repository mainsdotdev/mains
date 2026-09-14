/**
 * A small CommonMark + GFM subset parser, for agent messages.
 *
 * The desktop renders assistant text through `react-markdown` + `remark-gfm`
 * into a Tailwind `prose` block. Neither travels: there is no DOM here, and
 * every RN markdown package on npm is either unmaintained or fights the app's
 * own type ramp. What the transcript actually needs is small and bounded —
 * headings, lists (nested, ordered, task), emphasis, code, links, quotes,
 * rules, tables — so it is parsed here into a tree the renderer maps onto
 * `ThemedText` variants.
 *
 * Written to survive a *partial* document: assistant text arrives streamed, so
 * an unterminated fence or a half-written `**` must degrade, never throw.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "strike"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export interface ListItem {
  /** Nested blocks — a paragraph, then any sub-list. */
  blocks: Block[];
  /** `- [ ]` / `- [x]`; absent for a plain bullet. */
  checked?: boolean;
}

export type Block =
  | { type: "heading"; level: number; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "code"; lang: string | null; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(?:```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
/** A GFM delimiter row: `|---|:--:|`. Only meaningful under a header row. */
const TABLE_DELIM = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      // An unterminated fence is the normal mid-stream state; take what we have.
      if (i < lines.length) i++;
      blocks.push({ type: "code", lang: fence[1] || null, text: body.join("\n") });
      continue;
    }

    // Before the rule test: `---` under a paragraph is a setext underline, but
    // a bare `---` between blocks is a horizontal rule, which is all we support.
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        inline: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(quoted) });
      continue;
    }

    if (isListLine(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1])) {
      const [table, next] = parseTable(lines, i);
      blocks.push(table);
      i = next;
      continue;
    }

    // Paragraph: runs until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) {
      paragraph.push(lines[i].trim());
      i++;
    }
    if (paragraph.length > 0) {
      // A soft line break is a space, as CommonMark (and so the desktop's
      // `react-markdown`) has it — only a blank line starts a new paragraph.
      blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
    } else {
      // `startsBlock` matched the very first line but no branch above claimed
      // it — consume it as text so the loop cannot stall.
      blocks.push({ type: "paragraph", inline: parseInline(lines[i].trim()) });
      i++;
    }
  }

  return blocks;
}

function isListLine(line: string): boolean {
  return BULLET.test(line) || ORDERED.test(line);
}

function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    isListLine(line)
  );
}

function indentOf(line: string): number {
  return /^(\s*)/.exec(line)![1].replace(/\t/g, "    ").length;
}

/**
 * One list, from `start` to the first line that is neither an item at this
 * level nor indented under one. Each item's own lines are dedented and parsed
 * as blocks, so nesting — a sub-list, a second paragraph — comes for free.
 */
function parseList(lines: string[], start: number): [Block, number] {
  const baseIndent = indentOf(lines[start]);
  const ordered = ORDERED.test(lines[start]);
  const startNumber = ordered ? Number(ORDERED.exec(lines[start])![2]) : 1;

  const items: ListItem[] = [];
  let current: string[] | null = null;
  let i = start;

  const flush = () => {
    if (!current) return;
    const task = TASK.exec(current[0]);
    if (task) current[0] = task[2];
    items.push({
      blocks: parseBlocks(current),
      checked: task ? task[1].toLowerCase() === "x" : undefined,
    });
    current = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      // A blank line ends the list only if what follows is not still inside it.
      const next = lines[i + 1];
      if (next === undefined || (next.trim() !== "" && indentOf(next) <= baseIndent && !isListLine(next))) {
        break;
      }
      if (current) current.push("");
      i++;
      continue;
    }

    const marker = BULLET.exec(line) ?? ORDERED.exec(line);
    const indent = indentOf(line);

    if (marker && indent <= baseIndent) {
      flush();
      current = [marker[3]];
      i++;
      continue;
    }

    if (indent > baseIndent && current) {
      // Continuation or a nested list: dedent by this list's indent so the
      // recursive parse sees the sub-block at column zero.
      current.push(line.slice(Math.min(indent, baseIndent + 2)));
      i++;
      continue;
    }

    break;
  }

  flush();
  return [{ type: "list", ordered, start: startNumber, items }, i];
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseTable(lines: string[], start: number): [Block, number] {
  const header = splitRow(lines[start]).map(parseInline);
  let i = start + 2; // header + delimiter
  const rows: Inline[][][] = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
    rows.push(splitRow(lines[i]).map(parseInline));
    i++;
  }
  return [{ type: "table", header, rows }, i];
}

// ── inline ───────────────────────────────────────────────────────────────

/** Ordered so the longest marker wins: `**` before `*`, `~~` before nothing. */
const INLINE_PATTERNS: {
  re: RegExp;
  build: (m: RegExpExecArray) => Inline;
}[] = [
  { re: /^`([^`]+)`/, build: (m) => ({ type: "code", text: m[1] }) },
  { re: /^\*\*([\s\S]+?)\*\*/, build: (m) => ({ type: "strong", children: parseInline(m[1]) }) },
  { re: /^__([\s\S]+?)__/, build: (m) => ({ type: "strong", children: parseInline(m[1]) }) },
  { re: /^~~([\s\S]+?)~~/, build: (m) => ({ type: "strike", children: parseInline(m[1]) }) },
  { re: /^\*([^*\n]+)\*/, build: (m) => ({ type: "em", children: parseInline(m[1]) }) },
  { re: /^_([^_\n]+)_/, build: (m) => ({ type: "em", children: parseInline(m[1]) }) },
  {
    re: /^!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
    build: (m) => ({ type: "link", href: m[2], children: parseInline(m[1] || m[2]) }),
  },
  {
    re: /^<(https?:\/\/[^>\s]+)>/,
    build: (m) => ({ type: "link", href: m[1], children: [{ type: "text", text: m[1] }] }),
  },
  {
    re: /^(https?:\/\/[^\s<>()[\]]+)/,
    build: (m) => ({ type: "link", href: m[1], children: [{ type: "text", text: m[1] }] }),
  },
];

/** Characters that can open a construct — everything else is copied verbatim. */
const INLINE_TRIGGER = /[`*_~[!<h]/;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  let i = 0;

  const flush = () => {
    if (text) {
      out.push({ type: "text", text });
      text = "";
    }
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\\" && i + 1 < source.length) {
      text += source[i + 1];
      i += 2;
      continue;
    }

    if (!INLINE_TRIGGER.test(ch)) {
      text += ch;
      i++;
      continue;
    }

    const rest = source.slice(i);
    let matched = false;
    for (const { re, build } of INLINE_PATTERNS) {
      const m = re.exec(rest);
      if (!m) continue;
      flush();
      out.push(build(m));
      i += m[0].length;
      matched = true;
      break;
    }
    if (matched) continue;

    // An opener with no closer — mid-stream, or just literal punctuation.
    text += ch;
    i++;
  }

  flush();
  return out;
}
