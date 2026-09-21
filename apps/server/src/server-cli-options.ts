import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function readValue(argv: string[], name: string): string | undefined {
  const equals = argv.find((value) => value.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readValues(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith(`${name}=`)) {
      values.push(value.slice(name.length + 1));
    } else if (value === name && argv[index + 1] !== undefined) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function parsePort(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${name} must be an integer between 0 and 65535`);
  }
  return port;
}

export function parseServerCliOptions(argv: string[]): CliOptions {
  const configuredHost =
    readValue(argv, "--host") ?? process.env.MAINS_SERVE_HOST;
  if (argv.includes("--lan") && configuredHost && configuredHost !== "0.0.0.0") {
    throw new Error("--lan cannot be combined with a different --host");
  }
  const tailscalePort =
    readValue(argv, "--tailscale-serve-port") ??
    process.env.MAINS_TAILSCALE_SERVE_PORT;
  return {
    host: argv.includes("--lan")
      ? "0.0.0.0"
      : (configuredHost ?? "127.0.0.1"),
    port: parsePort(
      readValue(argv, "--port") ?? process.env.MAINS_SERVE_PORT,
      8787,
      "--port",
    ),
    token: readValue(argv, "--token") ?? process.env.MAINS_SERVE_TOKEN,
    webRoot: readValue(argv, "--web-root") ?? process.env.MAINS_SERVE_WEB_ROOT,
    dataDir:
      readValue(argv, "--data-dir") ??
      process.env.MAINS_SERVER_DATA_DIR ??
      defaultServerDataDir(),
    rotateToken: argv.includes("--rotate-token"),
    tailscaleServe:
      argv.includes("--tailscale-serve") ||
      process.env.MAINS_TAILSCALE_SERVE === "1",
    tailscaleServePort:
      tailscalePort === undefined
        ? undefined
        : parsePort(tailscalePort, 443, "--tailscale-serve-port"),
    publicUrls: [
      ...readValues(argv, "--public-url"),
      ...(process.env.MAINS_PUBLIC_URL ? [process.env.MAINS_PUBLIC_URL] : []),
    ],
    printPairing: !argv.includes("--no-pairing"),
  };
}

export function parsePairCliOptions(argv: string[]): PairCliOptions {
  return {
    dataDir:
      readValue(argv, "--data-dir") ??
      process.env.MAINS_SERVER_DATA_DIR ??
      defaultServerDataDir(),
    token: readValue(argv, "--token") ?? process.env.MAINS_SERVE_TOKEN,
    controlUrl:
      readValue(argv, "--server-url") ?? process.env.MAINS_SERVER_URL,
    endpoints: [
      ...readValues(argv, "--endpoint"),
      ...readValues(argv, "--public-url"),
    ],
    printQr: !argv.includes("--no-qr"),
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
