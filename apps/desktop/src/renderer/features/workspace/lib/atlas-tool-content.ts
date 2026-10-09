import { coerceToolOutput, toolOutputText } from "./parse-tool-content";

export function atlasRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function atlasToolHasError(output: unknown): boolean {
  return atlasRecord(coerceToolOutput(output))?.isError === true;
}

/** The providers carry the same Page in different text-block envelopes. */
export function atlasToolResult(output: unknown) {
  const value = coerceToolOutput(output);
  const envelope = atlasRecord(value);
  const structured = coerceToolOutput(envelope?.structuredContent);
  const result = atlasRecord(envelope?.item) ? value
    : atlasRecord(atlasRecord(structured)?.item) ? structured
    : coerceToolOutput(toolOutputText(envelope?.contentItems ?? structured ?? value));
  const page = atlasRecord(result);
  const item = atlasRecord(page?.item);
  const revision = atlasRecord(page?.revision);
  return {
    item, revision, isError: envelope?.isError === true,
    message: item ? "" : typeof result === "string" ? result
      : typeof page?.error === "string" ? page.error
      : typeof page?.message === "string" ? page.message : toolOutputText(result),
  };
}

function inlineText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(inlineText).join("");
  const node = atlasRecord(value);
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return inlineText(node.content);
}

/** An inert content preview, never an editor or the canonical saved document. */
export function atlasBlocksPreview(value: unknown, limit = 24, maxChars = 2000) {
  const rows: { type: string; text: string; depth: number; checked: boolean; number: number; truncated: boolean }[] = [];
  function visit(blocks: unknown, depth: number) {
    if (!Array.isArray(blocks) || depth > 8) return;
    let number = 0;
    for (const value of blocks) {
      if (rows.length >= limit) return;
      const block = atlasRecord(value);
      if (!block) continue;
      const props = atlasRecord(block.props);
      const content = atlasRecord(block.content);
      const tableRows = Array.isArray(content?.rows) ? content.rows : [];
      const table = tableRows.map((row) => {
        const cells = atlasRecord(row)?.cells;
        return Array.isArray(cells) ? cells.map(inlineText).join(" · ") : "";
      }).join("\n");
      const text = table || inlineText(block.content) ||
        (typeof props?.name === "string" ? props.name : typeof props?.url === "string" ? props.url : "");
      number = block.type === "numberedListItem" ? number + 1 : 0;
      rows.push({ type: typeof block.type === "string" ? block.type : "paragraph",
        text: text.slice(0, maxChars), depth, checked: props?.checked === true, number, truncated: text.length > maxChars });
      visit(block.children, depth + 1);
    }
  }
  visit(coerceToolOutput(value), 0);
  return rows;
}
