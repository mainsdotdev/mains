import fs from "node:fs";
import path from "node:path";
import {
  findPackageRoot,
  parseServerCliOptions,
} from "./server-cli-options";
import { resolveStandaloneServerToken } from "./server-token";
import { startStandaloneServer } from "./standalone-server";

function findResourcesPath(): string | null {
  const candidates = [
    __dirname,
    path.resolve(__dirname, "../../../packages/backend/src/db"),
  ];
  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, "migrations")),
    ) ?? null
  );
}

function readAppVersion(packageRoot: string): string {
  const packagePath = path.join(packageRoot, "package.json");
  const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string" || !parsed.version) {
    throw new Error(`Missing version in ${packagePath}`);
  }
  return parsed.version;
}

function findDevelopmentWebRoot(packageRoot: string): string | undefined {
  const candidate = path.resolve(packageRoot, "../desktop/dist-web");
  return fs.existsSync(path.join(candidate, "index.html"))
    ? candidate
    : undefined;
}

function printHelp(): void {
  console.log(`Mains standalone server

Usage: mains-server [options]
       npm run serve -- [options]  (development)

  --host <address>              Bind address (default: 127.0.0.1)
  --port <number>               HTTP/WebSocket port (default: 8787)
  --token <token>               Pairing token (overrides the stored token)
  --rotate-token                Generate and persist a new pairing token
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
  const { rotateToken, ...serverOptions } = options;
  const packageRoot = findPackageRoot(__dirname);
  const token = resolveStandaloneServerToken(serverOptions.dataDir, {
    explicitToken: serverOptions.token,
    rotate: rotateToken,
  });
  if (token.path) {
    console.log(
      `[serve] ${token.created ? "created" : "using"} pairing token file: ${token.path}`,
    );
  }
  const server = await startStandaloneServer({
    ...serverOptions,
    webRoot:
      serverOptions.webRoot ?? findDevelopmentWebRoot(packageRoot),
    token: token.token,
    appVersion: readAppVersion(packageRoot),
    appRoot: packageRoot,
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
