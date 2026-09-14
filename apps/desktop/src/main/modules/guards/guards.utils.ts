// ─────────────────────────────────────────────────────────────
// Guards Utilities
// Install command parsing and manifest detection
// ─────────────────────────────────────────────────────────────

import type { PackageEcosystem, PackageIdentifier } from "./adapters/adapter.types";

export interface ParsedInstallCommand {
  ecosystem: PackageEcosystem;
  packages: PackageIdentifier[];
}

/**
 * Install command patterns:
 * Each entry matches a package manager command and its ecosystem.
 * The regex captures the remaining arguments after the install verb.
 */
const INSTALL_PATTERNS: Array<{
  pattern: RegExp;
  ecosystem: PackageEcosystem;
}> = [
  // npm install|add|i <pkg> [<pkg>...]
  { pattern: /\bnpm\s+(?:install|i|add)\s+(.+)/i, ecosystem: "npm" },
  // yarn add <pkg> [<pkg>...]
  { pattern: /\byarn\s+add\s+(.+)/i, ecosystem: "npm" },
  // pnpm add|install <pkg> [<pkg>...]
  { pattern: /\bpnpm\s+(?:add|install|i)\s+(.+)/i, ecosystem: "npm" },
  // bun add|install <pkg> [<pkg>...]
  { pattern: /\bbun\s+(?:add|install|i)\s+(.+)/i, ecosystem: "npm" },
  // pip install|pip3 install <pkg> [<pkg>...]
  { pattern: /\bpip3?\s+install\s+(.+)/i, ecosystem: "pypi" },
  // cargo add <pkg> [<pkg>...]
  { pattern: /\bcargo\s+add\s+(.+)/i, ecosystem: "cargo" },
  // go get <pkg> [<pkg>...]
  { pattern: /\bgo\s+get\s+(.+)/i, ecosystem: "go" },
  // gem install <pkg> [<pkg>...]
  { pattern: /\bgem\s+install\s+(.+)/i, ecosystem: "rubygems" },
];

/**
 * Flags/options to strip from the argument list (they're not package names)
 */
const IGNORED_FLAGS = new Set([
  "-D", "--save-dev", "--dev",
  "-S", "--save", "--save-exact", "-E",
  "-g", "--global",
  "-P", "--save-peer",
  "-O", "--save-optional",
  "--no-save",
  "--legacy-peer-deps",
  "--force", "-f",
  "--production",
  "--upgrade", "-U",
  "--user",
  "--system",
  "--break-system-packages",
  "--features",
  "--no-default-features",
  "-v", "--verbose",
]);

const FLAGS_WITH_VALUES = new Set([
  "--cache",
  "--config",
  "--include",
  "--omit",
  "--prefix",
  "--registry",
  "--scope",
  "--tag",
  "--workspace",
  "-C",
  "-c",
  "-w",
]);

/**
 * Parse a shell command and extract package identifiers if it's an install command.
 * Returns null if the command is not a package install.
 */
export function parseInstallCommand(command: string): ParsedInstallCommand | null {
  // Normalize: collapse whitespace, trim
  const normalized = command.replace(/\s+/g, " ").trim();

  for (const { pattern, ecosystem } of INSTALL_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const argsStr = match[1].trim();
    const packages = extractPackageNames(argsStr, ecosystem);

    if (packages.length > 0) {
      return { ecosystem, packages };
    }
  }

  return null;
}

/**
 * Extract package identifiers from the argument string of an install command.
 * Filters out flags, file paths, and URLs.
 */
function extractPackageNames(argsStr: string, ecosystem: PackageEcosystem): PackageIdentifier[] {
  const tokens = tokenize(truncateAtShellSeparator(argsStr));
  const packages: PackageIdentifier[] = [];

  let skipNext = false;
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    // Skip flags
    if (token.startsWith("-")) {
      if (IGNORED_FLAGS.has(token)) continue;
      // Flags that take a value (e.g., --registry <url>)
      if (FLAGS_WITH_VALUES.has(token)) {
        skipNext = true;
      }
      continue;
    }

    // Skip file paths and URLs
    if (token.startsWith(".") || token.startsWith("/") || token.startsWith("~")) continue;
    if (token.includes("://")) continue;
    // Skip git repos
    if (token.includes("github:") || token.includes("git+")) continue;

    // Parse name@version
    const parsed = parsePackageToken(token, ecosystem);
    if (parsed) {
      packages.push(parsed);
    }
  }

  return packages;
}

function truncateAtShellSeparator(input: string): string {
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }

    if (ch === ";" || ch === "|" || (ch === "&" && input[i + 1] === "&")) {
      return input.slice(0, i).trim();
    }
  }

  return input;
}

/**
 * Parse a single token like "express@4.18.0" or "@types/node@22"
 */
function parsePackageToken(token: string, ecosystem: PackageEcosystem): PackageIdentifier | null {
  if (!token) return null;

  // npm scoped packages: @scope/name@version
  if (ecosystem === "npm" && token.startsWith("@")) {
    const slashIdx = token.indexOf("/");
    if (slashIdx === -1) return null; // Invalid scoped package

    const afterScope = token.slice(slashIdx + 1);
    const atIdx = afterScope.indexOf("@");

    if (atIdx > 0) {
      return {
        name: token.slice(0, slashIdx + 1 + atIdx),
        version: afterScope.slice(atIdx + 1),
        ecosystem,
      };
    }
    return { name: token, ecosystem };
  }

  // Regular: name@version
  const atIdx = token.lastIndexOf("@");
  if (atIdx > 0) {
    return {
      name: token.slice(0, atIdx),
      version: token.slice(atIdx + 1),
      ecosystem,
    };
  }

  // Python: name==version or name>=version
  if (ecosystem === "pypi") {
    const pyMatch = token.match(/^([a-zA-Z0-9_.-]+)(?:[=<>!~]+(.+))?$/);
    if (pyMatch) {
      return {
        name: pyMatch[1],
        version: pyMatch[2],
        ecosystem,
      };
    }
  }

  return { name: token, ecosystem };
}

/**
 * Simple tokenizer that respects quotes
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}
