import type { Nodes, Parent, Root } from "mdast";
import type { Processor } from "unified";
import type { VFile } from "vfile";

/**
 * Before `)` arrives, Markdown treats a link as text (and GFM may even linkify
 * its unfinished URL). Keep that trailing construct out of the rendered tree
 * until it is complete, just as we do for an open display equation.
 */
export function remarkStreamingLinks(this: Processor) {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    const inline = trailingInline(tree, source);
    if (!inline) return;
    const cutoff = pendingLinkStart(inline, source);
    if (cutoff === null) return;

    // Reparse the visible prefix so escapes, entities and container prefixes
    // retain their Markdown meaning. Slicing a decoded text node by a source
    // offset would corrupt those cases. Parsing does not rerun transformers.
    return this.parse(source.slice(0, cutoff)) as Root;
  };
}

function trailingInline(node: Nodes, source: string): Parent | null {
  if (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "tableCell"
  ) {
    const end = node.position?.end.offset;
    const tail = end === undefined ? "" : source.slice(end);
    const boundary = node.type === "tableCell" ? /^[\s|]*$/ : /^\s*$/;
    if (end !== undefined && boundary.test(tail)) {
      return node;
    }
  }
  if ("children" in node) {
    for (let index = node.children.length - 1; index >= 0; index--) {
      const inline = trailingInline(node.children[index], source);
      if (inline) return inline;
    }
  }
  return null;
}

function pendingLinkStart(inline: Parent, source: string): number | null {
  const start = inline.position?.start.offset;
  const end = inline.position?.end.offset;
  if (start === undefined || end === undefined) return null;

  const literals = new Map<number, { end: number; link: boolean }>();
  function collect(node: Nodes): void {
    if (
      node.type === "inlineCode" ||
      node.type === "inlineMath" ||
      node.type === "html" ||
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "linkReference" ||
      node.type === "link"
    ) {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from !== undefined && to !== undefined) {
        literals.set(from, {
          end: to,
          link: node.type === "linkReference" ||
            (node.type === "link" && "[<".includes(source[from])),
        });
      }
    } else if ("children" in node) {
      node.children.forEach(collect);
    }
  }
  inline.children.forEach(collect);

  const brackets: number[] = [];
  for (let index = start; index < end; index++) {
    const literal = literals.get(index);
    if (literal) {
      // Links cannot contain other links. A completed inner link makes an
      // earlier `[` ordinary prose; images and code can still be in a label.
      if (literal.link) brackets.length = 0;
      index = literal.end - 1;
      continue;
    }
    const char = source[index];
    if (char === "\\") {
      index++;
    } else if (char === "`" && brackets.length) {
      // A code span in a pending label may itself be unfinished. Its `]`
      // must not expose the label before the closing ticks arrive.
      return brackets[0];
    } else if (char === "[" || (char === "!" && source[index + 1] === "[")) {
      brackets.push(index);
      if (char === "!") index++;
    } else if (char === "]" && brackets.length) {
      const opening = brackets.pop()!;
      // At EOF even `[label]` may still become `[label](url)` next frame.
      if (index + 1 === end) return brackets[0] ?? opening;
      if (source[index + 1] === "(") {
        const close = resourceEnd(source, index + 1, end);
        if (close === null) return brackets[0] ?? opening;
        index = close;
      }
    }
  }
  return brackets[0] ?? null;
}

/** Respect nested URL parentheses, escaped markers, angle paths and titles. */
function resourceEnd(source: string, opening: number, end: number): number | null {
  let depth = 1;
  let quote: string | null = null;
  let angle = false;
  for (let index = opening + 1; index < end; index++) {
    const char = source[index];
    if (char === "\\") {
      index++;
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (angle) {
      if (char === ">") angle = false;
    } else if (char === "<") {
      angle = true;
    } else if ((char === '"' || char === "'") && /\s/.test(source[index - 1])) {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth === 0) {
      return index;
    }
  }
  return null;
}
