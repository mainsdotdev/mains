import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startStandaloneServer } from "./standalone-server";

interface CliOptions {
  host: string;
  port: number;
  token?: string;
  webRoot?: string;
  dataDir: string;
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
    tailscaleServe:
      argv.includes("--tailscale-serve") ||
      process.env.MAINS_TAILSCALE_SERVE === "1",
    tailscaleServePort:
      tailscalePort === undefined
        ? undefined
        : parsePort(tailscalePort, 443, "--tailscale-serve-port"),
  };
}

function findResourcesPath(): string | null {
  const candidates = [__dirname, path.join(__dirname, "db")];
  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, "migrations")),
    ) ?? null
  );
}

function readAppVersion(): string {
  const packagePath = path.resolve(__dirname, "../..", "package.json");
  const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string" || !parsed.version) {
    throw new Error(`Missing version in ${packagePath}`);
  }
  return parsed.version;
}

function printHelp(): void {
  console.log(`Mains standalone server

Usage: npm run serve:node -- [options]

  --host <address>              Bind address (default: 127.0.0.1)
  --port <number>               HTTP/WebSocket port (default: 8787)
  --token <token>               Pairing token (generated when omitted)
  --data-dir <path>             Dedicated server state directory
  --web-root <path>             Built Mains web UI directory
  --tailscale-serve             Publish through Tailscale Serve
  --tailscale-serve-port <port> Tailscale HTTPS port (default: 443)
  --help                        Show this help

The server uses its own data directory by default. Do not point Electron and
the standalone server at the same SQLite database concurrently.`);
}

export async function runServerCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const options = parseServerCliOptions(argv);
  const server = await startStandaloneServer({
    ...options,
    appVersion: readAppVersion(),
    appRoot: path.resolve(__dirname, "../.."),
    resourcesPath: findResourcesPath(),
  });
  console.log(`[serve] standalone data directory: ${server.dataDir}`);

  let stopping = false;
  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(`[serve] received ${signal}; shutting down`);
    try {
      await server.close();
      console.log("[serve] shutdown complete");
    } catch (error) {
      console.error("[serve] shutdown failed", error);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

void runServerCli().catch((error) => {
  console.error(
    `[serve] failed to start: ${error instanceof Error ? error.stack ?? error.message : error}`,
  );
  process.exitCode = 1;
});
