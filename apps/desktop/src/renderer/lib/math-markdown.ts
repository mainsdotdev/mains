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
