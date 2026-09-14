export interface PreparedMathMarkdown {
  source: string;
  hasMath: boolean;
}

/**
 * Prepare model-authored TeX for remark-math without touching fenced or inline
 * code. Models commonly use `\(...\)` and `\[...\]`; remark-math expects dollar
 * delimiters. Display delimiters get their own lines so they remain blocks.
 */
export function prepareMathMarkdown(source: string): PreparedMathMarkdown {
  const normalizedNewlines = source.replace(/\r\n?/g, "\n");
  const lines = normalizedNewlines.split("\n");
  let fence: "`" | "~" | null = null;
  let convertedDelimiter = false;

  const normalized = lines
    .map((line) => {
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as "`" | "~";
        if (fence === marker) fence = null;
        else if (fence === null) fence = marker;
        return line;
      }
      if (fence !== null) return line;

      const result = normalizeOutsideInlineCode(line);
      convertedDelimiter ||= result.converted;
      return result.text;
    })
    .join("\n");

  return {
    source: normalized,
    hasMath: convertedDelimiter || hasDollarMath(normalized),
  };
}

function normalizeOutsideInlineCode(line: string): { text: string; converted: boolean } {
  let text = "";
  let codeTicks = 0;
  let converted = false;

  for (let index = 0; index < line.length; ) {
    if (line[index] === "`") {
      let end = index + 1;
      while (line[end] === "`") end++;
      const count = end - index;
      if (codeTicks === 0) codeTicks = count;
      else if (count === codeTicks) codeTicks = 0;
      text += line.slice(index, end);
      index = end;
      continue;
    }

    if (codeTicks === 0) {
      const delimiter = line.slice(index, index + 2);
      if (delimiter === "\\[" || delimiter === "\\]") {
        text += "\n$$\n";
        converted = true;
        index += 2;
        continue;
      }
      if (delimiter === "\\(" || delimiter === "\\)") {
        text += "$";
        converted = true;
        index += 2;
        continue;
      }
    }

    text += line[index];
    index++;
  }

  return { text, converted };
}

function hasDollarMath(source: string): boolean {
  if (/\$\$[\s\S]*?\$\$/.test(source)) return true;

  for (const match of source.matchAll(/(?:^|[^\\$])\$([^$\n]+)\$(?!\$)/g)) {
    const expression = match[1].trim();
    if (
      /^[A-Za-z]$/.test(expression) ||
      /[\\_^{}=+*/<>]/.test(expression)
    ) {
      return true;
    }
  }
  return false;
}
