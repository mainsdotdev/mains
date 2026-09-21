import fs from "node:fs";
import path from "node:path";
import {
  findPackageRoot,
  parsePairCliOptions,
  parseServerCliOptions,
} from "./server-cli-options";
import {
  readStandaloneServerToken,
  resolveStandaloneServerToken,
} from "./server-token";
import { startStandaloneServer } from "./standalone-server";
import {
  discoverReachableEndpoints,
  normalizeEndpoint,
  resolveControlUrl,
} from "./server-endpoints";
import {
  clearServerState,
  readServerState,
  writeServerState,
} from "./server-state";
import {
  listPairedDevices,
  requestPairingCode,
  revokePairedDevice,
  type AdminClientOptions,
} from "./pairing-client";
import { printPairingCode } from "./pairing-output";
import { runServiceCommand } from "./service-manager";

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

Usage: mains-server [serve] [options]
       mains-server pair [options]
       mains-server auth <list|revoke> [options]
       mains-server service <action> [options]
       npm run serve -- [options]  (development)

  --host <address>              Bind address (default: 127.0.0.1)
  --lan                         Bind all interfaces and advertise private LAN IPs
  --port <number>               HTTP/WebSocket port (default: 8787)
  --token <token>               Full-access owner token (overrides the stored token)
  --rotate-token                Generate and persist a new owner token
  --data-dir <path>             Override the canonical Mains data directory
  --web-root <path>             Built Mains web UI directory
  --public-url <url>            Advertise an HTTPS/proxied URL (repeatable)
  --tailscale-serve             Publish through Tailscale Serve
  --tailscale-serve-port <port> Tailscale HTTPS port (default: 443)
  --no-pairing                  Do not print a startup pairing QR
  --help                        Show this help

Pair options:
  --endpoint <url>              Reachable phone URL (repeatable; defaults to server state)
  --server-url <url>            Running server control URL (defaults to server state)
  --token <token>               Running server owner token (defaults to its token file)
  --data-dir <path>             Server state directory
  --no-qr                       Print only the pairing link

Access management:
  auth list                     List paired phones
  auth revoke <device-id>       Revoke and disconnect one phone

Service actions (macOS LaunchAgent or Linux systemd user service):
  install, uninstall, start, stop, restart, status

Desktop and Server use the same Mains data by default. Only one backend may run
at a time; an ownership lock rejects concurrent access before SQLite opens.`);
}

async function runServeCommand(argv: string[]): Promise<void> {
  const options = parseServerCliOptions(argv);
  const { rotateToken, publicUrls, printPairing, ...serverOptions } = options;
  const packageRoot = findPackageRoot(__dirname);
  const appVersion = readAppVersion(packageRoot);
  const token = resolveStandaloneServerToken(serverOptions.dataDir, {
    explicitToken: serverOptions.token,
    rotate: rotateToken,
  });
  if (token.path) {
    console.log(
      `[serve] ${token.created ? "created" : "using"} owner token file: ${token.path}`,
    );
  }
  const server = await startStandaloneServer({
    ...serverOptions,
    webRoot:
      serverOptions.webRoot ?? findDevelopmentWebRoot(packageRoot),
    token: token.token,
    appVersion,
    appRoot: packageRoot,
    resourcesPath: findResourcesPath(),
  });
  console.log(`[serve] standalone data directory: ${server.dataDir}`);

  try {
    const endpoints = discoverReachableEndpoints({
      host: serverOptions.host,
      port: server.port,
      tailscaleUrl: server.tailscaleUrl,
      publicUrls,
    });
    writeServerState(server.dataDir, {
      schemaVersion: 1,
      pid: process.pid,
      host: serverOptions.host,
      port: server.port,
      controlUrl: resolveControlUrl(serverOptions.host, server.port),
      endpoints,
      appVersion,
      startedAt: new Date().toISOString(),
    });

    if (printPairing && endpoints.length > 0) {
      const pairing = await server.createPairingCode(endpoints);
      printPairingCode(
        { ...pairing, expiresAt: pairing.expiresAt.toISOString() },
        { qr: process.stdout.isTTY },
      );
    } else if (printPairing) {
      console.log(
        "[serve] phone pairing is not advertised on loopback; use --host 0.0.0.0, --tailscale-serve, or --public-url.",
      );
    }
  } catch (error) {
    clearServerState(server.dataDir);
    await server.close();
    throw error;
  }

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
    } finally {
      clearServerState(server.dataDir);
    }
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

async function runPairCommand(argv: string[]): Promise<void> {
  const options = parsePairCliOptions(argv);
  const { state, admin } = resolveAdminClient(options);
  const endpoints = (
    options.endpoints.length > 0 ? options.endpoints : (state?.endpoints ?? [])
  ).map(normalizeEndpoint);
  if (endpoints.length === 0) {
    throw new Error(
      "No phone-reachable endpoint is known. Pass --endpoint, or start with --host 0.0.0.0 / --tailscale-serve.",
    );
  }
  const pairing = await requestPairingCode({
    ...admin,
    endpoints,
  });
  printPairingCode(pairing, { qr: options.printQr && process.stdout.isTTY });
}

function resolveAdminClient(
  options: ReturnType<typeof parsePairCliOptions>,
): { state: ReturnType<typeof readServerState>; admin: AdminClientOptions } {
  const state = readServerState(options.dataDir);
  const controlUrl = options.controlUrl ?? state?.controlUrl;
  if (!controlUrl) {
    throw new Error(
      "No running Mains Server was found. Start it first or pass --server-url.",
    );
  }
  const token = options.token ?? readStandaloneServerToken(options.dataDir);
  if (!token) {
    throw new Error(
      "The owner token is not stored in this data directory. Pass --token for the running server.",
    );
  }
  return { state, admin: { controlUrl, token } };
}

async function runAuthCommand(argv: string[]): Promise<void> {
  const action = argv[0];
  if (action === "list") {
    const { admin } = resolveAdminClient(parsePairCliOptions(argv.slice(1)));
    const devices = await listPairedDevices(admin);
    if (devices.length === 0) {
      console.log("No paired phones.");
      return;
    }
    console.table(
      devices.map((device) => ({
        id: device.id,
        name: device.name,
        platform: device.platform,
        appVersion: device.appVersion ?? "—",
        lastSeen: device.lastSeenAt
          ? new Date(device.lastSeenAt).toLocaleString()
          : "never",
      })),
    );
    return;
  }
  if (action === "revoke") {
    const deviceId = argv[1];
    if (!deviceId || deviceId.startsWith("-")) {
      throw new Error("Usage: mains-server auth revoke <device-id>");
    }
    const { admin } = resolveAdminClient(parsePairCliOptions(argv.slice(2)));
    await revokePairedDevice(admin, deviceId);
    console.log(`Revoked paired device ${deviceId}.`);
    return;
  }
  throw new Error("Auth action must be one of: list, revoke");
}

export async function runServerCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    printHelp();
    return;
  }

  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "serve";
  const commandArgs = command === "serve" && argv[0] !== "serve" ? argv : argv.slice(1);
  if (command === "serve") {
    await runServeCommand(commandArgs);
    return;
  }
  if (command === "pair") {
    await runPairCommand(commandArgs);
    return;
  }
  if (command === "auth") {
    await runAuthCommand(commandArgs);
    return;
  }
  if (command === "service") {
    const [action, ...serviceArgs] = commandArgs;
    runServiceCommand(action, parseServerCliOptions(serviceArgs));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
