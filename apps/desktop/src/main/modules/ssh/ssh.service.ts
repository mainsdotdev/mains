import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import { request as httpRequest } from "http";
import { readFile } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { generateToken } from "../../ipc-kit/ws-auth";

/**
 * SSH access for remote backends. The `ssh` client runs on the LOCAL machine and
 * forwards a loopback port to a `mains serve` instance on the remote host, so the
 * renderer connects to `ws://127.0.0.1:<localPort>` and all traffic is tunneled
 * (encrypted + authenticated by SSH). This is the secure, zero-infrastructure
 * path — the remote backend never has to listen on a routable interface.
 *
 * See docs/design/remote-backend.md (Phase 5).
 */

export interface SshHost {
  alias: string;
  hostName: string | null;
  user: string | null;
  port: number | null;
}

export interface OpenTunnelInput {
  /** SSH target — an alias from ~/.ssh/config or `user@host`. */
  host: string;
  /** Loopback port the backend listens on, on the remote. */
  remotePort: number;
  /**
   * Optional command to launch the backend on the remote (e.g.
   * `cd ~/mains && npm run serve -- --port=8787`). When omitted, the tunnel
   * assumes a backend is already running (`ssh -N`).
   */
  remoteCommand?: string | null;
}

export interface TunnelHandle {
  id: string;
  localPort: number;
  localUrl: string;
  /**
   * Ephemeral pairing token generated when this tunnel auto-launches the backend
   * (via `remoteCommand`). The renderer must present it on the WS connection.
   * Absent when connecting to an already-running backend.
   */
  token?: string;
}

/** Parse the relevant fields out of an ~/.ssh/config file. Pure + best-effort. */
export function parseSshConfig(text: string): SshHost[] {
  const hosts: SshHost[] = [];
  let current: {
    aliases: string[];
    hostName: string | null;
    user: string | null;
    port: number | null;
  } | null = null;

  const flush = () => {
    if (!current) return;
    for (const alias of current.aliases) {
      hosts.push({
        alias,
        hostName: current.hostName,
        user: current.user,
        port: current.port,
      });
    }
    current = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toLowerCase();
    const value = parts.slice(1).join(" ");
    if (key === "host") {
      flush();
      // Skip pattern hosts (`*`, `?`); keep concrete aliases only.
      const aliases = parts
        .slice(1)
        .filter((a) => !a.includes("*") && !a.includes("?"));
      current = { aliases, hostName: null, user: null, port: null };
    } else if (current) {
      if (key === "hostname") current.hostName = value;
      else if (key === "user") current.user = value;
      else if (key === "port") {
        const p = Number(value);
        if (Number.isFinite(p)) current.port = p;
      }
    }
  }
  flush();
  return hosts;
}

/** Build the `ssh` argv for a loopback forward. Pure + testable. */
export function buildSshArgs(input: {
  localPort: number;
  host: string;
  remotePort: number;
  remoteCommand?: string | null;
}): string[] {
  const args = [
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-L",
    `${input.localPort}:127.0.0.1:${input.remotePort}`,
  ];
  if (input.remoteCommand && input.remoteCommand.trim()) {
    args.push(input.host, input.remoteCommand.trim());
  } else {
    args.push("-N", input.host);
  }
  return args;
}

/**
 * Hosts seen in ~/.ssh/known_hosts (so the picker isn't limited to aliases in
 * the config). Hashed entries (`|1|…`, from HashKnownHosts) can't be reversed,
 * so they're skipped. Pure + best-effort.
 */
export function parseKnownHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("|")) continue;
    const first = line.split(/\s+/)[0];
    if (!first) continue;
    for (const entry of first.split(",")) {
      let h = entry.trim();
      const bracket = h.match(/^\[(.+)\]:\d+$/); // [host]:port
      if (bracket) h = bracket[1];
      else h = h.replace(/:\d+$/, "");
      if (h && !h.includes("*") && !h.includes("?")) hosts.add(h);
    }
  }
  return [...hosts];
}

// `ssh host "<cmd>"` runs a NON-interactive, non-login shell where node version
// managers (volta/nvm/mise/fnm/asdf) aren't sourced — so `npm`/`node` are often
// missing and a bare `npm run serve` fails. Source them so the launch Just Works.
const NODE_LAUNCH_PREAMBLE = [
  `export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"`,
  `[ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"`,
  `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1`,
  `command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)" >/dev/null 2>&1`,
  `command -v mise >/dev/null 2>&1 && eval "$(mise activate bash 2>/dev/null)" >/dev/null 2>&1`,
  `[ -s "$HOME/.asdf/asdf.sh" ] && . "$HOME/.asdf/asdf.sh" >/dev/null 2>&1`,
].join("\n");

/**
 * Wrap a user-provided launch command with the node-discovery preamble and the
 * ephemeral pairing token, so the remote `mains serve` starts even from a bare
 * non-interactive SSH shell. Pure + testable.
 */
export function wrapRemoteLaunch(userCommand: string, token: string): string {
  return `${NODE_LAUNCH_PREAMBLE}\nexport MAINS_SERVE_TOKEN='${token}'\n${userCommand.trim()}`;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("No free port"))));
    });
  });
}

/**
 * Resolve once the backend actually responds with HTTP through the tunnel — any
 * status (even 426/401) means it's up — not merely once the SSH forward is
 * listening. Catches the just-launched-but-not-yet-ready window. Rejects if ssh
 * exits or the backend never responds before the timeout.
 */
function probeHttpReady(
  port: number,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += String(d);
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  return new Promise<void>((resolve, reject) => {
    const retry = () => {
      if (Date.now() > deadline) {
        reject(
          new Error(
            `backend not ready after ${Math.round(timeoutMs / 1000)}s${
              stderr.trim() ? `: ${stderr.trim()}` : ""
            }`,
          ),
        );
      } else {
        setTimeout(attempt, 500);
      }
    };
    const attempt = () => {
      if (exited) {
        reject(new Error(`ssh exited: ${stderr.trim() || "unknown error"}`));
        return;
      }
      const req = httpRequest(
        { host: "127.0.0.1", port, path: "/", method: "GET", timeout: 3000 },
        (res) => {
          res.resume(); // drain; any HTTP response means the backend is up
          resolve();
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
      req.end();
    };
    attempt();
  });
}

const tunnels = new Map<string, ChildProcess>();
let tunnelCounter = 0;

export const sshService = {
  /** Hosts from ~/.ssh/config + ~/.ssh/known_hosts (best-effort; deduped). */
  async discoverHosts(): Promise<SshHost[]> {
    const sshDir = path.join(homedir(), ".ssh");
    const [configText, knownText] = await Promise.all([
      readFile(path.join(sshDir, "config"), "utf-8").catch(() => ""),
      readFile(path.join(sshDir, "known_hosts"), "utf-8").catch(() => ""),
    ]);
    const configHosts = parseSshConfig(configText);
    const seen = new Set(configHosts.map((h) => h.alias));
    const knownHosts: SshHost[] = parseKnownHosts(knownText)
      .filter((h) => !seen.has(h))
      .map((h) => ({ alias: h, hostName: h, user: null, port: null }));
    return [...configHosts, ...knownHosts];
  },

  /** Open a tunnel and return the local ws URL the renderer should connect to. */
  async openTunnel(input: OpenTunnelInput): Promise<TunnelHandle> {
    if (!input?.host || typeof input.host !== "string") {
      throw new Error("SSH host is required");
    }
    if (!Number.isInteger(input.remotePort) || input.remotePort <= 0) {
      throw new Error("A valid remote port is required");
    }
    let child: ChildProcess | null = null;
    try {
      const localPort = await getFreePort();

      // When we launch the backend ourselves, generate an ephemeral token and
      // hand it to the remote serve via the environment (plus a node-discovery
      // preamble so npm is found in the bare SSH shell), then present the same
      // token on the (tunneled) WS connection. Nothing is persisted.
      const userCommand = input.remoteCommand?.trim() || undefined;
      let token: string | undefined;
      let remoteCommand = userCommand;
      if (userCommand) {
        token = generateToken();
        remoteCommand = wrapRemoteLaunch(userCommand, token);
      }

      const args = buildSshArgs({
        localPort,
        host: input.host,
        remotePort: input.remotePort,
        remoteCommand,
      });
      child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
      const id = `tunnel-${++tunnelCounter}`;
      tunnels.set(id, child);
      child.on("exit", () => tunnels.delete(id));

      // Launching the backend (Electron boot) takes longer than attaching to one
      // that's already running.
      await probeHttpReady(localPort, child, userCommand ? 45_000 : 15_000);
      return {
        id,
        localPort,
        localUrl: `ws://127.0.0.1:${localPort}`,
        token,
      };
    } catch (error) {
      // Kill the half-open tunnel before surfacing the failure.
      if (child && !child.killed) child.kill();
      throw error;
    }
  },

  async closeTunnel(id: string): Promise<void> {
    const child = tunnels.get(id);
    if (child && !child.killed) child.kill();
    tunnels.delete(id);
  },

  /** Kill every tunnel (called on app shutdown). */
  closeAllTunnels(): void {
    for (const child of tunnels.values()) {
      if (!child.killed) child.kill();
    }
    tunnels.clear();
  },
};
