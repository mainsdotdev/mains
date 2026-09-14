export interface ShellCommandPreview {
  command: string;
  shell?: string;
}

/**
 * Split a simple `<shell> -c "…"` transport wrapper from the command it runs.
 * Ambiguous quoting stays untouched so an approval preview never hides shell
 * semantics it cannot represent faithfully.
 */
export function parseShellCommandPreview(rawCommand: string): ShellCommandPreview {
  const match = rawCommand.match(
    /^(?:(?:\/usr)?\/bin\/)?(zsh|bash|sh)\s+(-[A-Za-z]*c[A-Za-z]*)\s+([\s\S]+)$/,
  );
  if (!match) return { command: rawCommand };

  const command = unwrapWholeQuotedValue(match[3].trim());
  if (command === undefined) return { command: rawCommand };

  return {
    command,
    shell: `${match[1]} ${match[2]}`,
  };
}

function unwrapWholeQuotedValue(value: string): string | undefined {
  if (value.length < 2) return undefined;
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value.at(-1) !== quote) {
    return undefined;
  }

  // The outer quote must own the complete value. An earlier closing quote
  // means the command uses shell concatenation/expansion and stays raw.
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] !== quote) continue;
    if (quote === "\"" && isEscaped(value, i)) continue;
    return undefined;
  }

  return value.slice(1, -1);
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}
