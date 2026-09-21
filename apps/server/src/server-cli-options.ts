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
}

function defaultDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Mains Server");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "Mains Server",
    );
  }
  return path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
    "mains-server",
  );
}

function readValue(argv: string[], name: string): string | undefined {
  const equals = argv.find((value) => value.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
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
  const tailscalePort =
    readValue(argv, "--tailscale-serve-port") ??
    process.env.MAINS_TAILSCALE_SERVE_PORT;
  return {
    host: readValue(argv, "--host") ?? process.env.MAINS_SERVE_HOST ?? "127.0.0.1",
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
      defaultDataDir(),
    rotateToken: argv.includes("--rotate-token"),
    tailscaleServe:
      argv.includes("--tailscale-serve") ||
      process.env.MAINS_TAILSCALE_SERVE === "1",
    tailscaleServePort:
      tailscalePort === undefined
        ? undefined
        : parsePort(tailscalePort, 443, "--tailscale-serve-port"),
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
