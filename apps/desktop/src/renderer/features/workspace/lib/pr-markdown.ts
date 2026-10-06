export type PrMarkdownAction = "heading" | "bold" | "italic" | "quote" | "code" | "link" | "numbered" | "bullet" | "checklist";

/** Transform a textarea selection and return the selection to restore after React paints. */
export function formatPrMarkdown(value: string, start: number, end: number, action: PrMarkdownAction) {
  const selected = value.slice(start, end);
  const wrap = (before: string, after: string, placeholder: string) => {
    const text = selected || placeholder;
    return { value: value.slice(0, start) + before + text + after + value.slice(end),
      start: start + before.length, end: start + before.length + text.length };
  };
  if (action === "bold") return wrap("**", "**", "bold text");
  if (action === "italic") return wrap("_", "_", "italic text");
  if (action === "link") return wrap("[", "](https://example.com)", "link text");
  if (action === "code") return selected.includes("\n") ? wrap("```\n", "\n```", "code") : wrap("`", "`", "code");

  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const lastSelected = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextLine = value.indexOf("\n", lastSelected);
  const lineEnd = nextLine < 0 ? value.length : nextLine;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const prefix = (index: number) => ({ heading: "### ", quote: "> ", numbered: `${index + 1}. `, bullet: "- ", checklist: "- [ ] " })[action];
  const replacement = lines.map((line, index) => prefix(index) + line).join("\n");
  return { value: value.slice(0, lineStart) + replacement + value.slice(lineEnd),
    start: lineStart + prefix(0).length, end: lineStart + replacement.length };
}
