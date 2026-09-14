import { networkInterfaces } from "node:os";
import { emit } from "../../ipc-kit";
import { startWsHost, type WsHost } from "../../ipc-kit/ws-server-host";
import { generateToken } from "../../ipc-kit/ws-auth";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { resolveWebRoot } from "../../web-root";
import { imageProxyService } from "../imageProxy/imageProxy.service";
import { serveLocalImage, serveLocalDocument } from "../imageProxy";
import { tailscaleService } from "../tailscale";
import { appSettingsService } from "../appSettings";
import {
  backendService,
  type PairedDevice,
  type PairingCode,
} from "../backend";

/**
 * "This machine" exposure — turns the RUNNING desktop app into a backend other
 * clients can drive (a phone browser, a LAN device, or another mains over an SSH
 * tunnel). The Electron main already registers every IPC handler into the
 * handler-registry (via the ipcMain shim), so an in-process {@link startWsHost}
 * routes to the same handlers + same DB — no separate `serve` process, no repo,
 * no terminal.
 *
 * Two independent access paths over one in-process WS host (fixed port, so SSH
 * tunnels have a stable target):
 *  - **Network access** — bind 0.0.0.0 so loopback (SSH target), the LAN IP, and
 *    the Tailscale IP all reach it (token-gated).
 *  - **Tailscale HTTPS** — `tailscale serve` proxies a MagicDNS HTTPS URL to the
 *    loopback port.
 *
 * Control IPC is registered LOCAL-only (real electron ipcMain), so a remote
 * client can't toggle the exposure it's riding on.
 */

const DEFAULT_PORT = 8787;
const DEFAULT_HTTPS_PORT = 443;

export interface BackendAddress {
  label: string;
  /** http://<host>:<port> */
  url: string;
  /** http://<host>:<port>/?token=… — open in a browser. */
  webUrl: string;
  /** ws://<host>:<port> — paste into another mains' Direct URL field. */
  wsUrl: string;
}

export interface LocalBackendStatus {
  /** Loopback exposure — SSH tunnels can attach to the running app. */
  remoteAccess: boolean;
  /** ALSO bind 0.0.0.0 so LAN / Tailscale IPs reach it directly (less private). */
  lanAccess: boolean;
  port: number;
  token: string | null;
  /** 0.0.0.0 (LAN) or 127.0.0.1 (loopback only) or null (host down). */
  bindHost: string | null;
  /** This machine / Local network / Tailscale IP — when the host is up. */
  addresses: BackendAddress[];
  tailscale: boolean;
  magicDnsName: string | null;
  tailscaleHttpsUrl: string | null;
  tailscaleWebUrl: string | null;
  /** wss://<magicdns> — paste into another mains' Direct URL field. */
  tailscaleWsUrl: string | null;
  /** False when no built web renderer was found (run `npm run build:web`). */
  webUiAvailable: boolean;
}

let wsHost: WsHost | null = null;
let bindHost: string | null = null;
let sessionToken: string | null = null;
let port = DEFAULT_PORT;
let remoteAccess = false;
let lanAccess = false;
let tailscale: { httpsPort: number; magicDnsName: string | null } | null = null;
let webRootCached: string | null | undefined;

function webRoot(): string | null {
  if (webRootCached === undefined) webRootCached = resolveWebRoot();
  return webRootCached;
}

/** LAN + Tailscale IPv4 addresses of this machine. */
function localIps(): { lan: string | null; tailscale: string | null } {
  let lan: string | null = null;
  let ts: string | null = null;
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const [o1, o2] = a.address.split(".").map(Number);
      if (o1 === 100 && o2 >= 64 && o2 <= 127) ts = ts ?? a.address; // CGNAT (Tailscale)
      else lan = lan ?? a.address;
    }
  }
  return { lan, tailscale: ts };
}

function buildAddresses(): BackendAddress[] {
  if (!wsHost) return [];
  const q = sessionToken ? `?token=${sessionToken}` : "";
  const mk = (label: string, host: string): BackendAddress => ({
    label,
    url: `http://${host}:${port}`,
    webUrl: `http://${host}:${port}/${q}`,
    wsUrl: `ws://${host}:${port}`,
  });
  const list = [mk("This machine", "127.0.0.1")];
  const { lan, tailscale: tsIp } = localIps();
  if (lanAccess && lan) list.push(mk("Local network", lan));
  if (lanAccess && tsIp) list.push(mk("Tailscale IP", tsIp));
  return list;
}

function buildStatus(): LocalBackendStatus {
  const httpsUrl =
    tailscale?.magicDnsName != null
      ? tailscaleService.resolveHttpsUrl(tailscale.magicDnsName, tailscale.httpsPort)
      : null;
  return {
    remoteAccess,
    lanAccess,
    port,
    token: wsHost ? sessionToken : null,
    bindHost,
    addresses: buildAddresses(),
    tailscale: tailscale !== null,
    magicDnsName: tailscale?.magicDnsName ?? null,
    tailscaleHttpsUrl: httpsUrl,
    tailscaleWebUrl: httpsUrl
      ? `${httpsUrl}/${sessionToken ? `?token=${sessionToken}` : ""}`
      : null,
    tailscaleWsUrl: httpsUrl ? httpsUrl.replace(/^https:/, "wss:") : null,
    webUiAvailable: webRoot() !== null,
  };
}

/** Let the desktop UI refresh its paired-phone list (a pairing, a connection, a revoke). */
function notifyPairedDevicesChanged(): void {
  emit(CHANNELS.localBackend.pairedDevicesChanged, {});
}

/** Persist the toggle state so it's restored on the next launch (best-effort). */
function persist(): void {
  void appSettingsService
    .updateBackendAccess({
      backendRemoteAccess: remoteAccess,
      backendLanAccess: lanAccess,
      backendTailscaleHttps: tailscale !== null,
    })
    .catch(() => {});
}

/** Bring the in-process WS host to the bind the current toggles require. */
async function reconcileHost(): Promise<void> {
  const wantHost = remoteAccess || tailscale !== null;
  // LAN access binds all interfaces; otherwise loopback only (SSH still works —
  // the tunnel forwards to 127.0.0.1 — but nothing is exposed on the network).
  const desiredBind = remoteAccess && lanAccess ? "0.0.0.0" : "127.0.0.1";

  if (!wantHost) {
    if (wsHost) {
      await wsHost.close().catch(() => {});
      wsHost = null;
      bindHost = null;
    }
    // No exposure left: forget the token so the next start mints a fresh one.
    // Turning access off is how a user expects to invalidate a leaked token.
    sessionToken = null;
    return;
  }
  if (wsHost && bindHost !== desiredBind) {
    await wsHost.close().catch(() => {});
    wsHost = null;
  }
  if (!wsHost) {
    if (!sessionToken) sessionToken = generateToken();
    wsHost = await startWsHost({
      port,
      host: desiredBind,
      token: sessionToken,
      webRoot: webRoot(),
      fetchProxiedImage: (url) => imageProxyService.proxyImage(url),
      serveLocalImage: (url) => serveLocalImage(url),
      serveLocalDocument: (url) => serveLocalDocument(url),
      // Paired phones authenticate with their own token instead of the shared
      // session token, and new ones pair through `POST /pair`.
      verifyDeviceToken: async (token) => {
        const device = await backendService.verifyDeviceToken(token);
        if (device) notifyPairedDevicesChanged();
        return device;
      },
      pairDevice: async (body) => {
        const result = await backendService.pairDevice(body);
        notifyPairedDevicesChanged();
        return result;
      },
      commandReceipts: backendService.commandReceipts,
    });
    bindHost = desiredBind;
    port = wsHost.port;
  }
}

/**
 * Addresses a phone could reach this host on, most private first. Loopback is
 * omitted — nothing off this machine can use it. Empty when only loopback is
 * bound, which is the signal that pairing can't work yet.
 */
function pairingEndpoints(): string[] {
  const out: string[] = [];
  if (tailscale?.magicDnsName) {
    out.push(
      tailscaleService.resolveHttpsUrl(tailscale.magicDnsName, tailscale.httpsPort),
    );
  }
  if (lanAccess) {
    const { lan, tailscale: tsIp } = localIps();
    if (lan) out.push(`http://${lan}:${port}`);
    if (tsIp) out.push(`http://${tsIp}:${port}`);
  }
  return out;
}

export const localBackendService = {
  getStatus(): LocalBackendStatus {
    return buildStatus();
  },

  /** Toggle loopback exposure (SSH tunnels can attach to the running app). */
  async setRemoteAccess(
    enabled: boolean,
    desiredPort?: number,
  ): Promise<LocalBackendStatus> {
    if (desiredPort && Number.isInteger(desiredPort) && !wsHost) {
      port = desiredPort;
    }
    remoteAccess = enabled;
    if (!enabled) lanAccess = false; // LAN access requires the base exposure
    await reconcileHost();
    persist();
    return buildStatus();
  },

  /** Toggle LAN access (binds 0.0.0.0 so LAN + Tailscale IPs reach it directly). */
  async setLanAccess(enabled: boolean): Promise<LocalBackendStatus> {
    lanAccess = enabled && remoteAccess;
    await reconcileHost();
    persist();
    return buildStatus();
  },

  /** Toggle Tailscale HTTPS (`tailscale serve` → MagicDNS). Throws on failure. */
  async setTailscaleHttps(
    enabled: boolean,
    httpsPort = DEFAULT_HTTPS_PORT,
  ): Promise<LocalBackendStatus> {
    if (enabled) {
      tailscale = { httpsPort, magicDnsName: null };
      try {
        await reconcileHost(); // ensure the loopback host is up first
        await tailscaleService.startServe(port, httpsPort);
        const status = await tailscaleService.readStatus();
        tailscale = { httpsPort, magicDnsName: status.magicDnsName };
      } catch (error) {
        // Roll back so getStatus reflects reality (toggle stays off) and persist()
        // isn't reached, so the failed state is never saved. startServe may have
        // ALREADY succeeded (e.g. readStatus then threw), so stop it too —
        // otherwise the daemon keeps proxying to a port we're about to tear down.
        try {
          await tailscaleService.stopServe(httpsPort);
        } catch {
          /* ignore — best effort */
        }
        tailscale = null;
        await reconcileHost();
        throw error;
      }
    } else {
      const prev = tailscale;
      tailscale = null;
      if (prev) {
        try {
          await tailscaleService.stopServe(prev.httpsPort);
        } catch {
          /* ignore */
        }
      }
      await reconcileHost();
    }
    persist();
    return buildStatus();
  },

  /**
   * Replace the shared session token. A running host is restarted on the same
   * port with the new one — the token is only checked at the WS handshake, so
   * a restart is what actually drops clients that authenticated with the old
   * token. Paired phones hold their own device tokens and simply reconnect;
   * Tailscale Serve keeps proxying to the same port.
   */
  async rotateToken(): Promise<LocalBackendStatus> {
    sessionToken = generateToken();
    if (wsHost) {
      await wsHost.close().catch(() => {});
      wsHost = null;
      bindHost = null;
    }
    await reconcileHost();
    return buildStatus();
  },

  /**
   * Mint a one-time pairing code (QR) for a phone. Needs the host up on an
   * address a phone can reach (LAN or Tailscale HTTPS), otherwise throws with
   * the toggle the user should flip.
   */
  async createPairingCode(): Promise<PairingCode> {
    if (!wsHost) {
      throw new Error("Turn on remote access before pairing a phone");
    }
    return backendService.createPairingCode(pairingEndpoints());
  },

  listPairedDevices(): Promise<PairedDevice[]> {
    return backendService.listPairedDevices();
  },

  async revokePairedDevice(id: string): Promise<void> {
    await backendService.revokePairedDevice(id);
    notifyPairedDevicesChanged();
  },

  /**
   * Re-apply the persisted exposure on startup. Remote/LAN access reconcile
   * synchronously (fast, in-process); Tailscale Serve is re-applied off the
   * critical path so cert provisioning never delays launch. Best-effort.
   */
  async restore(): Promise<void> {
    try {
      const row = await appSettingsService.getSettings();
      if (!row) return;
      remoteAccess = !!row.backendRemoteAccess;
      lanAccess = !!row.backendLanAccess && remoteAccess;
      if (remoteAccess) await reconcileHost();
      if (row.backendTailscaleHttps) {
        // setTailscaleHttps rolls back its own runtime state on failure; just
        // swallow the rejection so a closed Tailscale app doesn't crash startup
        // (the saved preference stays on for the next launch).
        void this.setTailscaleHttps(true).catch(() => {});
      }
    } catch {
      /* best-effort — exposure just stays off */
    }
  },

  /** Best-effort shutdown teardown (called from cleanupApp). */
  async shutdown(): Promise<void> {
    if (tailscale) {
      try {
        await tailscaleService.stopServe(tailscale.httpsPort);
      } catch {
        /* ignore */
      }
      tailscale = null;
    }
    remoteAccess = false;
    lanAccess = false;
    await reconcileHost();
  },
};
