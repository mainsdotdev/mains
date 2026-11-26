export function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Skill frontmatter fields are top-level scalars. Indented lines belong to
    // a block scalar (handled below) or to metadata we do not consume here.
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent > 0) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value: unknown = trimmed.slice(colonIndex + 1).trim();
    const blockStyle = (value as string).match(/^([>|])[+-]?(?:\s+#.*)?$/);

    if (blockStyle) {
      const blockLines: string[] = [];
      let nextIndex = index + 1;

      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex];
        const nextTrimmed = nextLine.trim();
        const nextIndent = nextLine.length - nextLine.trimStart().length;

        if (nextTrimmed && nextIndent <= lineIndent) break;

        blockLines.push(nextLine);
        nextIndex += 1;
      }

      const contentIndent = blockLines.reduce((smallest, blockLine) => {
        if (!blockLine.trim()) return smallest;
        const indent = blockLine.length - blockLine.trimStart().length;
        return Math.min(smallest, indent);
      }, Number.POSITIVE_INFINITY);
      const normalizedLines = blockLines.map((blockLine) =>
        blockLine.trim() && Number.isFinite(contentIndent)
          ? blockLine.slice(contentIndent)
          : "",
      );

      value =
        blockStyle[1] === "|"
          ? normalizedLines.join("\n").trim()
          : normalizedLines
              .reduce((folded, blockLine) => {
                if (!blockLine.trim()) return `${folded.trimEnd()}\n`;
                if (!folded || folded.endsWith("\n")) return folded + blockLine.trim();
                return `${folded} ${blockLine.trim()}`;
              }, "")
              .trim();
      index = nextIndex - 1;
    } else if (
      ((value as string).startsWith('"') && (value as string).endsWith('"')) ||
      ((value as string).startsWith("'") && (value as string).endsWith("'"))
    ) {
      const quoted = value as string;
      value = quoted.slice(1, -1);
      if (quoted.startsWith('"')) {
        try { value = JSON.parse(quoted); } catch { /* Keep legacy scalar parsing for YAML-specific escapes. */ }
      } else {
        value = (value as string).replace(/''/g, "'");
      }
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (value === "") {
      value = undefined;
    }

    result[key] = value;
  }

  return result;
}
