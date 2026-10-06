export interface PagePreviewRow {
  kind: "heading" | "paragraph" | "bullet" | "numbered" | "check" | "quote" | "code" | "image";
  text: string;
  depth: number;
  level?: number;
  checked?: boolean;
  marker?: string;
  url?: string;
}

const plainText = (text: string) => text
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
  .replace(/`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g, "$1$2$3")
  .trim();

/** A bounded, inert thumbnail projection. No editor, Markdown engine or HTML. */
export function pagePreviewRows(markdown: string): PagePreviewRow[] {
  const rows: PagePreviewRow[] = [];
  let code = false;
  let paragraphBreak = true;
  for (const line of markdown.slice(0, 2400).split("\n")) {
    if (rows.length >= 18) break;
    const text = line.trim();
    if (!text) { paragraphBreak = true; continue; }
    if (/^(```|~~~)/.test(text)) { code = !code; paragraphBreak = true; continue; }
    if (!code && /^(?:---+|\*\*\*+|___+)\s*$/.test(text)) { paragraphBreak = true; continue; }
    const depth = Math.min(3, Math.floor((line.length - line.trimStart().length) / 2));
    let row: PagePreviewRow;
    const heading = /^(#{1,6})\s+(.+)/.exec(text);
    const check = /^[-*+]\s+\[([ xX])\]\s*(.*)/.exec(text);
    const bullet = /^[-*+]\s+(.+)/.exec(text);
    const numbered = /^(\d+)[.)]\s+(.+)/.exec(text);
    if (code) row = { kind: "code", text, depth: 0 };
    else if (heading) row = { kind: "heading", level: heading[1].length, text: plainText(heading[2]), depth: 0 };
    else if (check) row = { kind: "check", checked: check[1].toLowerCase() === "x", text: plainText(check[2]), depth };
    else if (bullet) row = { kind: "bullet", text: plainText(bullet[1]), depth };
    else if (numbered) row = { kind: "numbered", marker: `${numbered[1]}.`, text: plainText(numbered[2]), depth };
    else if (text.startsWith(">")) row = { kind: "quote", text: plainText(text.replace(/^>\s*/, "")), depth: 0 };
    else if (text.startsWith("![")) row = { kind: "image", text: plainText(text) || "Image", depth: 0,
      url: /^!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/.exec(text)?.[1] };
    else row = { kind: "paragraph", text: plainText(text), depth: 0 };
    if (!row.text) continue;
    const previous = rows.at(-1);
    if (row.kind === "paragraph" && previous?.kind === "paragraph" && !paragraphBreak) {
      previous.text = `${previous.text} ${row.text}`.slice(0, 300);
    } else {
      row.text = row.text.length > 300 ? `${row.text.slice(0, 299)}…` : row.text;
      rows.push(row);
    }
    paragraphBreak = row.kind !== "paragraph";
  }
  return rows;
}
