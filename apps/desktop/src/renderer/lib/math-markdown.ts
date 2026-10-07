import type { Parent, Root } from "mdast";
import type { Extension } from "mdast-util-from-markdown";
import type {} from "remark-parse";
import type { Processor } from "unified";

/**
 * remark-math accepts EOF as the end of a display equation. During streaming
 * that only means the next chunk has not arrived yet, so wait for a real fence
 * before sending its unfinished TeX to KaTeX. Inline math already needs a close.
 */
export function remarkStreamingMath(this: Processor) {
  const openedMath = new WeakSet<object>();
  const closedMath = new WeakSet<object>();
  const extension: Extension = {
    exit: {
      mathFlowFenceSequence() {
        // The parser emits this token for both fences, including inside lists
        // and quotes. Its buffer can be on top of the math node on the stack.
        const math = this.stack.find((node) => node.type === "math");
        if (!math) return;
        if (openedMath.has(math)) closedMath.add(math);
        else openedMath.add(math);
      },
    },
  };
  const data = this.data();
  (data.fromMarkdownExtensions ??= []).push(extension);

  function removeOpenMath(parent: Parent): void {
    parent.children = parent.children.filter(
      (node) => node.type !== "math" || closedMath.has(node),
    );
    for (const child of parent.children) {
      if ("children" in child) removeOpenMath(child);
    }
  }

  return (tree: Root) => removeOpenMath(tree);
}

/**
 * Models commonly emit TeX's `\(...\)` / `\[...\]` delimiters while
 * remark-math understands dollar delimiters. Translate only outside Markdown
 * code so examples remain examples instead of turning into live equations.
 */
export function normalizeMathMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let fence: "`" | "~" | null = null;

  return lines
    .map((line) => {
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as "`" | "~";
        if (fence === marker) fence = null;
        else if (fence === null) fence = marker;
        return line;
      }
      return fence === null ? normalizeOutsideInlineCode(line) : line;
    })
    .join("\n");
}

function normalizeOutsideInlineCode(line: string): string {
  let output = "";
  let codeTicks = 0;

  for (let index = 0; index < line.length; ) {
    if (line[index] === "`") {
      let end = index + 1;
      while (line[end] === "`") end++;
      const count = end - index;
      if (codeTicks === 0) codeTicks = count;
      else if (count === codeTicks) codeTicks = 0;
      output += line.slice(index, end);
      index = end;
      continue;
    }

    if (codeTicks === 0) {
      const delimiter = line.slice(index, index + 2);
      if (delimiter === "\\[" || delimiter === "\\]") {
        // A display delimiter is block-level even when the model emits the
        // whole equation on one line. Give remark-math the blank-line shape
        // it needs to distinguish it from inline math.
        output += "\n$$\n";
        index += 2;
        continue;
      }
      if (delimiter === "\\(" || delimiter === "\\)") {
        output += "$";
        index += 2;
        continue;
      }
    }

    output += line[index];
    index++;
  }

  return output;
}
