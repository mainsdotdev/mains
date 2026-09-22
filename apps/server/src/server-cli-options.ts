import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateStandaloneOwnerToken } from "./server-token";

export interface CliOptions {
  host: string;
  port: number;
  token?: string;
  webRoot?: string;
  dataDir: string;
  rotateToken: boolean;
  tailscaleServe: boolean;
  tailscaleServePort?: number;
  publicUrls: string[];
  printPairing: boolean;
}

export interface PairCliOptions {
  dataDir: string;
  token?: string;
  controlUrl?: string;
  endpoints: string[];
  printQr: boolean;
}

export interface WebCliOptions {
  dataDir: string;
  token?: string;
  controlUrl?: string;
  baseUrl?: string;
}

export function defaultServerDataDir(): string {
  return path.dirname(defaultDesktopDatabasePath());
}

export function defaultDesktopDatabasePath(): string {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "mains",
      "mains.db",
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ??
        path.join(os.homedir(), "AppData", "Roaming"),
      "mains",
      "mains.db",
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "mains",
    "mains.db",
  );
}

type CliOptionDefinition =
  | { kind: "flag" }
  | { kind: "value"; repeatable?: boolean };

type CliOptionSchema = Readonly<Record<string, CliOptionDefinition>>;

interface ParsedCliOptions {
  flags: ReadonlySet<string>;
  values: ReadonlyMap<string, string[]>;
}

const SERVER_OPTION_SCHEMA = {
  "--host": { kind: "value" },
  "--lan": { kind: "flag" },
  "--port": { kind: "value" },
  "--token": { kind: "value" },
  "--data-dir": { kind: "value" },
  "--web-root": { kind: "value" },
  "--public-url": { kind: "value", repeatable: true },
  "--rotate-token": { kind: "flag" },
  "--tailscale-serve": { kind: "flag" },
  "--tailscale-serve-port": { kind: "value" },
  "--no-pairing": { kind: "flag" },
} satisfies CliOptionSchema;

const PAIR_OPTION_SCHEMA = {
  "--data-dir": { kind: "value" },
  "--token": { kind: "value" },
  "--server-url": { kind: "value" },
  "--endpoint": { kind: "value", repeatable: true },
  "--public-url": { kind: "value", repeatable: true },
  "--no-qr": { kind: "flag" },
} satisfies CliOptionSchema;

const WEB_OPTION_SCHEMA = {
  "--data-dir": { kind: "value" },
  "--token": { kind: "value" },
  "--server-url": { kind: "value" },
  "--url": { kind: "value" },
} satisfies CliOptionSchema;

function parseCliOptions(
  argv: string[],
  schema: CliOptionSchema,
): ParsedCliOptions {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const equalsIndex = argument.indexOf("=");
    const name = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const definition = schema[name];
    if (!definition) {
      throw new Error(`Unknown option: ${name}`);
    }

    const alreadySpecified = flags.has(name) || values.has(name);
    if (
      alreadySpecified &&
      !(definition.kind === "value" && definition.repeatable)
    ) {
      throw new Error(`${name} may only be specified once`);
    }

    if (definition.kind === "flag") {
      if (equalsIndex !== -1) {
        throw new Error(`${name} does not take a value`);
      }
      flags.add(name);
      continue;
    }

    let value: string;
    if (equalsIndex !== -1) {
      value = argument.slice(equalsIndex + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${name} requires a value`);
      }
      value = next;
      index += 1;
    }
    if (!value) {
      throw new Error(`${name} requires a value`);
    }

    const existing = values.get(name);
    if (existing) existing.push(value);
    else values.set(name, [value]);
  }

  return { flags, values };
}

function optionValue(
  parsed: ParsedCliOptions,
  name: string,
): string | undefined {
  return parsed.values.get(name)?.[0];
}

function optionValues(parsed: ParsedCliOptions, name: string): string[] {
  return parsed.values.get(name) ?? [];
}

function ownerToken(parsed: ParsedCliOptions): string | undefined {
  const explicit = optionValue(parsed, "--token");
  if (explicit !== undefined) {
    return validateStandaloneOwnerToken(explicit, "--token");
  }
  const environment = process.env.MAINS_SERVE_TOKEN;
  return environment === undefined
    ? undefined
    : validateStandaloneOwnerToken(environment, "MAINS_SERVE_TOKEN");
}

function parsePort(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${name} must be an integer between 0 and 65535`);
  }
  return port;
}

export function parseServerCliOptions(argv: string[]): CliOptions {
  const parsed = parseCliOptions(argv, SERVER_OPTION_SCHEMA);
  const configuredHost =
    optionValue(parsed, "--host") ?? process.env.MAINS_SERVE_HOST;
  if (
    parsed.flags.has("--lan") &&
    configuredHost &&
    configuredHost !== "0.0.0.0"
  ) {
    throw new Error("--lan cannot be combined with a different --host");
  }
  const tailscalePort =
    optionValue(parsed, "--tailscale-serve-port") ??
    process.env.MAINS_TAILSCALE_SERVE_PORT;
  return {
    host: parsed.flags.has("--lan")
      ? "0.0.0.0"
      : (configuredHost ?? "127.0.0.1"),
    port: parsePort(
      optionValue(parsed, "--port") ?? process.env.MAINS_SERVE_PORT,
      8787,
      "--port",
    ),
    token: ownerToken(parsed),
    webRoot:
      optionValue(parsed, "--web-root") ?? process.env.MAINS_SERVE_WEB_ROOT,
    dataDir:
      optionValue(parsed, "--data-dir") ??
      process.env.MAINS_SERVER_DATA_DIR ??
      defaultServerDataDir(),
    rotateToken: parsed.flags.has("--rotate-token"),
    tailscaleServe:
      parsed.flags.has("--tailscale-serve") ||
      process.env.MAINS_TAILSCALE_SERVE === "1",
    tailscaleServePort:
      tailscalePort === undefined
        ? undefined
        : parsePort(tailscalePort, 443, "--tailscale-serve-port"),
    publicUrls: [
      ...optionValues(parsed, "--public-url"),
      ...(process.env.MAINS_PUBLIC_URL ? [process.env.MAINS_PUBLIC_URL] : []),
    ],
    printPairing: !parsed.flags.has("--no-pairing"),
  };
}

export function parsePairCliOptions(argv: string[]): PairCliOptions {
  const parsed = parseCliOptions(argv, PAIR_OPTION_SCHEMA);
  return {
    dataDir:
      optionValue(parsed, "--data-dir") ??
      process.env.MAINS_SERVER_DATA_DIR ??
      defaultServerDataDir(),
    token: ownerToken(parsed),
    controlUrl:
      optionValue(parsed, "--server-url") ?? process.env.MAINS_SERVER_URL,
    endpoints: [
      ...optionValues(parsed, "--endpoint"),
      ...optionValues(parsed, "--public-url"),
    ],
    printQr: !parsed.flags.has("--no-qr"),
  };
}

export function parseWebCliOptions(argv: string[]): WebCliOptions {
  const parsed = parseCliOptions(argv, WEB_OPTION_SCHEMA);
  return {
    dataDir:
      optionValue(parsed, "--data-dir") ??
      process.env.MAINS_SERVER_DATA_DIR ??
      defaultServerDataDir(),
    token: ownerToken(parsed),
    controlUrl:
      optionValue(parsed, "--server-url") ?? process.env.MAINS_SERVER_URL,
    baseUrl: optionValue(parsed, "--url"),
  };
}

export function findPackageRoot(startPath: string): string {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not find package.json above ${startPath}`);
    }
    current = parent;
  }
}
