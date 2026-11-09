import { networkInterfaces } from "node:os";
import { powerMonitor, powerSaveBlocker } from "electron";
import { emit } from "@mains/backend/ipc-kit";
import {
  startWsHost,
  type WebLoginLink,
  type WsHost,
} from "@mains/backend/ipc-kit/ws-server-host";
import { generateToken } from "@mains/backend/ipc-kit/ws-auth";
import { CHANNELS } from "@mains/contracts/channels";
import { resolveWebRoot } from "@mains/backend/web-root";
import {
  imageProxyService,
  serveLocalImage,
  serveLocalDocument,
} from "@mains/backend/modules/imageProxy";
import { tailscaleService } from "@mains/backend/modules/tailscale";
import { appSettingsService } from "@mains/backend/modules/appSettings";
import {
  backendService,
  clearPairingCodes,
  type PairedDevice,
  type PairingCode,
} from "@mains/backend/modules/backend";
import { createRemoteAccessCleanup, createRemoteAccessCommands, createRemoteAwakeLease, shouldKeepRemoteHostAwake } from "../../../shared/remote-access-lifecycle";

const accessCommands = createRemoteAccessCommands();

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
  /** wss://<magicdns> — paste into another mains' Direct URL field. */
  tailscaleWsUrl: string | null;
  /** False when no built web renderer was found (run `npm run build:web`). */
  webUiAvailable: boolean;
  /** User preference; effective only while remote access is exposed and on AC. */
  keepAwakeForRemoteAccess: boolean;
}

let wsHost: WsHost | null = null;
let bindHost: string | null = null;
let sessionToken: string | null = null;
let hostToken: string | null = null;
const hostCleanup = createRemoteAccessCleanup<WsHost>();
const tailscaleCleanup = createRemoteAccessCleanup<{ httpsPort: number; magicDnsName: string | null }>();
let port = DEFAULT_PORT;
let remoteAccess = false;
let lanAccess = false;
let tailscale: { httpsPort: number; magicDnsName: string | null } | null = null;
let keepAwakeForRemoteAccess = false;
const remoteSleepLease = createRemoteAwakeLease();
let powerSourceListenersInstalled = false;
let webRootCached: string | null | undefined;

function onBatteryPower(): boolean {
  try {
    return powerMonitor.isOnBatteryPower();
  } catch {
    // Some Linux desktop environments do not expose power-source state.
    // Treat them as AC-powered so the explicit preference still works.
    return false;
  }
}

function reconcileRemoteSleepBlocker(): void {
  const shouldBlock = shouldKeepRemoteHostAwake({
    enabled: keepAwakeForRemoteAccess,
    remoteAccess,
    tailscale: tailscale !== null,
    onBatteryPower: onBatteryPower(),
    hostReady: isHostReady(),
  });

  remoteSleepLease.reconcile(shouldBlock, {
    isStarted: (id) => powerSaveBlocker.isStarted(id),
    start: () => powerSaveBlocker.start("prevent-app-suspension"),
    stop: (id) => powerSaveBlocker.stop(id),
  });
}

function onPowerSourceChanged(): void {
  try { reconcileRemoteSleepBlocker(); }
  catch (error) { console.error("Unable to update remote-access sleep ownership:", error); }
}

function installPowerSourceListeners(): void {
  if (powerSourceListenersInstalled) return;
  powerMonitor.on("on-ac", onPowerSourceChanged);
  powerMonitor.on("on-battery", onPowerSourceChanged);
  powerSourceListenersInstalled = true;
}

function removePowerSourceListeners(): void {
  if (!powerSourceListenersInstalled) return;
  powerMonitor.removeListener("on-ac", onPowerSourceChanged);
  powerMonitor.removeListener("on-battery", onPowerSourceChanged);
  powerSourceListenersInstalled = false;
}

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
  if (!isHostReady()) return [];
  const mk = (label: string, host: string): BackendAddress => ({
    label,
    url: `http://${host}:${port}`,
    wsUrl: `ws://${host}:${port}`,
  });
  const list = [mk("This machine", "127.0.0.1")];
  const { lan, tailscale: tsIp } = localIps();
  if (bindHost === "0.0.0.0" && lan) list.push(mk("Local network", lan));
  if (bindHost === "0.0.0.0" && tsIp) list.push(mk("Tailscale IP", tsIp));
  return list;
}

function buildStatus(): LocalBackendStatus {
  const httpsUrl =
    tailscale?.magicDnsName != null && !tailscaleCleanup.owns(tailscale) && isHostReady()
      ? tailscaleService.resolveHttpsUrl(tailscale.magicDnsName, tailscale.httpsPort)
      : null;
  return {
    remoteAccess,
    lanAccess,
    port,
    token: isHostReady() ? hostToken : null,
    bindHost,
    addresses: buildAddresses(),
    tailscale: tailscale !== null,
    magicDnsName: tailscale?.magicDnsName ?? null,
    tailscaleHttpsUrl: httpsUrl,
    tailscaleWsUrl: httpsUrl ? httpsUrl.replace(/^https:/, "wss:") : null,
    webUiAvailable: webRoot() !== null,
    keepAwakeForRemoteAccess,
  };
}

/** A paired device as the desktop's list shows it. */
export type LocalPairedDevice = PairedDevice & { connected: boolean };

/**
 * Let the desktop UI refresh its device list: a pairing, a device connecting
 * or dropping off, a rename, a revoke.
 */
function notifyPairedDevicesChanged(): void {
  emit(CHANNELS.localBackend.pairedDevicesChanged, {});
}

/** Persist the toggle state so it's restored on the next launch (best-effort). */
async function persist(): Promise<void> {
  await appSettingsService
    .updateBackendAccess({
      backendRemoteAccess: remoteAccess,
      backendLanAccess: lanAccess,
      backendTailscaleHttps: tailscale !== null,
      keepAwakeForRemoteAccess,
    })
    .catch(() => {});
}

function isHostReady(): boolean {
  return accessCommands.active() && wsHost !== null && !hostCleanup.owns(wsHost) && hostToken === sessionToken &&
    (remoteAccess || (tailscale !== null && tailscale.magicDnsName !== null && !tailscaleCleanup.owns(tailscale)));
}

async function stopTailscale(): Promise<void> {
  const owned = tailscale;
  if (!owned) return;
  await tailscaleCleanup.release(owned, () => tailscaleService.stopServe(owned.httpsPort));
  if (tailscale === owned) tailscale = null;
}

function runAccessCommand<T>(effect: (current: () => boolean) => Promise<T>): Promise<T> {
  return accessCommands.run(async (current) => {
    try { return await effect(current); }
    catch (error) {
      // A failed rebind/rotation must not retain sleep ownership for a host
      // that no longer exists. Preserve the original command failure.
      if (!isHostReady()) onPowerSourceChanged();
      throw error;
    }
  });
}

function assertCurrent(current: () => boolean): void {
  if (!current()) throw new Error("Remote access is shutting down");
}

async function closeHost(): Promise<void> {
  const owned = wsHost;
  if (!owned) return;
  await hostCleanup.release(owned, () => owned.close());
  if (wsHost === owned) { wsHost = null; bindHost = null; hostToken = null; }
}

/** Bring the in-process WS host to the bind the current toggles require. */
async function reconcileHost(current: () => boolean = () => true): Promise<void> {
  if (!current()) { await closeHost(); assertCurrent(current); }
  if (hostCleanup.owns(wsHost)) await closeHost();
  const wantHost = remoteAccess || tailscale !== null;
  // LAN access binds all interfaces; otherwise loopback only (SSH still works —
  // the tunnel forwards to 127.0.0.1 — but nothing is exposed on the network).
  const desiredBind = remoteAccess && lanAccess ? "0.0.0.0" : "127.0.0.1";

  if (!wantHost) {
    await closeHost();
    // No exposure left: forget the token so the next start mints a fresh one.
    // Turning access off is how a user expects to invalidate a leaked token.
    sessionToken = null;
    return;
  }
  if (wsHost && bindHost !== desiredBind) {
    await closeHost();
    assertCurrent(current);
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
      // Paired devices authenticate with their own token instead of the shared
      // session token, and new ones pair through `POST /pair`. The last-seen
      // stamp verifying records reaches the list with the connection change
      // below, once the socket is open and counts as connected.
      verifyDeviceToken: (token) => backendService.verifyDeviceToken(token),
      retirePairingCodes: clearPairingCodes,
      pairDevice: async (body) => {
        const result = await backendService.pairDevice(body);
        notifyPairedDevicesChanged();
        return result;
      },
      commandReceipts: backendService.commandReceipts,
      onDeviceConnectionChange: () => notifyPairedDevicesChanged(),
    });
    bindHost = desiredBind;
    hostToken = sessionToken;
    port = wsHost.port;
    if (!current()) { await closeHost(); assertCurrent(current); }
  }
}

/**
 * Addresses a phone could reach this host on, most private first. Loopback is
 * omitted — nothing off this machine can use it. Empty when only loopback is
 * bound, which is the signal that pairing can't work yet.
 */
function pairingEndpoints(): string[] {
  const out: string[] = [];
  if (tailscale?.magicDnsName && !tailscaleCleanup.owns(tailscale)) {
    out.push(
      tailscaleService.resolveHttpsUrl(tailscale.magicDnsName, tailscale.httpsPort),
    );
  }
  if (bindHost === "0.0.0.0") {
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
    return runAccessCommand(async (current) => {
      const previous = { remoteAccess, lanAccess, port };
      try {
        if (desiredPort && Number.isInteger(desiredPort) && !wsHost) port = desiredPort;
        remoteAccess = enabled;
        if (!enabled) lanAccess = false;
        await reconcileHost(current);
        assertCurrent(current);
        reconcileRemoteSleepBlocker();
        await persist();
        return buildStatus();
      } catch (error) {
        if (current() && !isHostReady()) {
          remoteAccess = previous.remoteAccess;
          lanAccess = previous.lanAccess;
          if (!wsHost) port = previous.port;
          if (!wsHost && !tailscale) sessionToken = null;
        }
        throw error;
      }
    });
  },

  /** Toggle LAN access (binds 0.0.0.0 so LAN + Tailscale IPs reach it directly). */
  async setLanAccess(enabled: boolean): Promise<LocalBackendStatus> {
    return runAccessCommand(async (current) => {
      lanAccess = enabled && remoteAccess;
      await reconcileHost(current);
      assertCurrent(current);
      await persist();
      return buildStatus();
    });
  },

  /** Toggle Tailscale HTTPS (`tailscale serve` → MagicDNS). Throws on failure. */
  async setTailscaleHttps(
    enabled: boolean,
    httpsPort = DEFAULT_HTTPS_PORT,
  ): Promise<LocalBackendStatus> {
    return runAccessCommand(async (current) => {
      if (enabled) {
        const ready = tailscale?.httpsPort === httpsPort && tailscale.magicDnsName !== null && !tailscaleCleanup.owns(tailscale);
        if (!ready) {
          await stopTailscale();
          tailscale = { httpsPort, magicDnsName: null };
          try {
            await reconcileHost(current);
            assertCurrent(current);
            await tailscaleService.startServe(port, httpsPort);
            assertCurrent(current);
            const status = await tailscaleService.readStatus();
            assertCurrent(current);
            tailscale = { httpsPort, magicDnsName: status.magicDnsName };
          } catch (error) {
            // Serve may have started even if its request/status lookup failed.
            // Keep its target host until that uncertain acquisition is released.
            await stopTailscale();
            await reconcileHost(current);
            throw error;
          }
        } else {
          await reconcileHost(current);
        }
      } else {
        await stopTailscale();
        await reconcileHost(current);
      }
      assertCurrent(current);
      reconcileRemoteSleepBlocker();
      await persist();
      return buildStatus();
    });
  },

  /** Keep an AC-powered remote host reachable between runs. */
  async setKeepAwakeForRemoteAccess(
    enabled: boolean,
  ): Promise<LocalBackendStatus> {
    return runAccessCommand(async () => {
      keepAwakeForRemoteAccess = enabled;
      installPowerSourceListeners();
      reconcileRemoteSleepBlocker();
      await persist();
      return buildStatus();
    });
  },

  /**
   * Replace the shared session token. A running host is restarted on the same
   * port with the new one — the token is only checked at the WS handshake, so
   * a restart is what actually drops clients that authenticated with the old
   * token. Paired devices hold their own device tokens and simply reconnect;
   * Tailscale Serve keeps proxying to the same port.
   */
  async rotateToken(): Promise<LocalBackendStatus> {
    return runAccessCommand(async (current) => {
      sessionToken = generateToken();
      await closeHost();
      assertCurrent(current);
      await reconcileHost(current);
      assertCurrent(current);
      return buildStatus();
    });
  },

  /**
   * Mint a one-time pairing code (QR) for a phone. Needs the host up on an
   * address a phone can reach (LAN or Tailscale HTTPS), otherwise throws with
   * the toggle the user should flip.
   */
  async createPairingCode(): Promise<PairingCode> {
    if (!isHostReady()) {
      throw new Error("Turn on remote access before pairing a device");
    }
    return backendService.createPairingCode(pairingEndpoints());
  },

  /** Mint a five-minute, one-use browser login for one advertised origin. */
  createWebLogin(baseUrl: string): WebLoginLink {
    if (!isHostReady() || !wsHost) {
      throw new Error("Turn on remote access before creating a browser login");
    }
    let origin: string;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      throw new Error("Invalid browser URL");
    }
    const allowed = new Set(buildAddresses().map((address) => address.url));
    const status = buildStatus();
    if (status.tailscaleHttpsUrl) allowed.add(status.tailscaleHttpsUrl);
    if (!allowed.has(origin)) {
      throw new Error("Browser login URL is not an advertised backend address");
    }
    return wsHost.createWebLogin(origin);
  },

  /** The paired devices, each marked with whether it holds a socket now. */
  async listPairedDevices(): Promise<LocalPairedDevice[]> {
    const devices = await backendService.listPairedDevices();
    const connected = wsHost?.connectedDeviceIds() ?? new Set<string>();
    return devices.map((device) => ({
      ...device,
      connected: connected.has(device.id),
    }));
  },

  async renamePairedDevice(id: string, name: string): Promise<PairedDevice> {
    const device = await backendService.renamePairedDevice(id, name);
    notifyPairedDevicesChanged();
    return device;
  },

  async revokePairedDevice(id: string): Promise<void> {
    await backendService.revokePairedDevice(id);
    // The token is checked only at the handshake: drop the sockets the device
    // already holds, or it keeps working until it happens to reconnect.
    wsHost?.disconnectDevice(id);
    notifyPairedDevicesChanged();
  },

  /**
   * Re-apply persisted exposure through the command queue on startup.
   * Tailscale Serve is re-applied off the
   * critical path so cert provisioning never delays launch. Best-effort.
   */
  async restore(): Promise<void> {
    const ticket = accessCommands.captureRestore();
    if (!ticket) return;
    try {
      const row = await appSettingsService.getSettings();
      if (!row || !ticket()) return;
      await accessCommands.restore(ticket, async (current) => {
        remoteAccess = !!row.backendRemoteAccess;
        lanAccess = !!row.backendLanAccess && remoteAccess;
        keepAwakeForRemoteAccess = !!row.keepAwakeForRemoteAccess;
        installPowerSourceListeners();
        if (remoteAccess) await reconcileHost(current);
        assertCurrent(current);
        reconcileRemoteSleepBlocker();
      });
      // Startup is background work. A newer manual command or shutdown must
      // also retire this continuation before Tailscale can be re-enabled.
      if (row.backendTailscaleHttps && ticket()) {
        void this.setTailscaleHttps(true).catch(() => {});
      }
    } catch {
      /* best-effort — explicit controls can retry a failed startup */
    }
  },

  /** Best-effort shutdown teardown (called from cleanupApp). */
  async shutdown(): Promise<void> {
    return accessCommands.shutdown(async () => {
      remoteAccess = false;
      lanAccess = false;
      try {
        await stopTailscale();
        await reconcileHost();
      } finally {
        try { reconcileRemoteSleepBlocker(); }
        finally { removePowerSourceListeners(); }
      }
    });
  },
};
