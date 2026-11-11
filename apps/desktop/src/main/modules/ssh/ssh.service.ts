import { readFile } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { parseSshConfig, parseKnownHosts } from "./ssh.utils";
import { createSshTunnelLifecycle } from "./ssh-tunnel-lifecycle";
export { parseSshConfig, parseKnownHosts, buildSshArgs, wrapRemoteLaunch } from "./ssh.utils";

export interface SshHost {
  alias: string;
  hostName: string | null;
  user: string | null;
  port: number | null;
}

export interface OpenTunnelInput {
  /** SSH target — an alias from ~/.ssh/config or `user@host`. */
  host: string;
  /** Unique per connection intent; supports cancellation before readiness. */
  requestId?: string;
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
   * Ephemeral owner token generated when this tunnel auto-launches the backend
   * (via `remoteCommand`). The renderer must present it on the WS connection.
   * Absent when connecting to an already-running backend.
   */
  token?: string;
}

const tunnels = createSshTunnelLifecycle();
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

  start: tunnels.start,
  openTunnel: tunnels.open,
  closeTunnel: tunnels.close,
  cancelTunnelOpen: tunnels.cancel,
  closeAllTunnels: tunnels.shutdown,
};
