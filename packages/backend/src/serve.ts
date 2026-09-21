import { closeDatabase, initializeDatabase } from "./db/client";
import { startWsHost, type WsHost } from "./ipc-kit/ws-server-host";
import { generateToken } from "./ipc-kit/ws-auth";

// Backend IPC registrations — the same handlers the Electron host registers (see
// apps/desktop/src/main/index.ts), now reachable over WebSocket. Keep this list
// in sync with that composition root. Renderer-/shell-only modules are omitted
// from the headless backend: browser (drives a local BrowserView), the Electron
// half of imageProxy (custom protocols), and updates (app self-update).
import { registerAccountIpc, unregisterAccountIpc } from "./modules/account";
import {
  backendService,
  registerBackendIpc,
  unregisterBackendIpc,
} from "./modules/backend";
import { registerSyncIpc, unregisterSyncIpc } from "./modules/sync";
import {
  registerEntitiesHandlers,
  unregisterEntitiesHandlers,
} from "./modules/entities";
import {
  registerConnectionsHandlers,
  unregisterConnectionsHandlers,
} from "./modules/connections";
import { registerSpaceIpc, unregisterSpaceIpc } from "./modules/space";
import {
  registerAppSettingsIpc,
  unregisterAppSettingsIpc,
} from "./modules/appSettings";
import {
  registerProvidersIpc,
  shutdownAllWorkAdapters,
  unregisterProvidersIpc,
} from "./modules/providers";
import { registerToolsIpc, unregisterToolsIpc } from "./modules/tools";
import {
  registerWorkspaceIpc,
  unregisterWorkspaceIpc,
} from "./modules/workspace";
import { registerProjectsIpc, unregisterProjectsIpc } from "./modules/projects";
import {
  registerCollectionsIpc,
  unregisterCollectionsIpc,
} from "./modules/collections";
import { registerRunsIpc, unregisterRunsIpc } from "./modules/runs";
import { runSessionRegistry } from "./modules/runs/run-session-registry";
import {
  registerFileExplorerIpc,
  unregisterFileExplorerIpc,
} from "./modules/fileExplorer";
import { registerGitFlowIpc, unregisterGitFlowIpc } from "./modules/gitFlow";
import {
  destroyAllTerminals,
  registerTerminalIpc,
  unregisterTerminalIpc,
} from "./modules/terminal";
import { registerStatsIpc, unregisterStatsIpc } from "./modules/stats";
import {
  registerAutomationsIpc,
  automationsService,
  unregisterAutomationsIpc,
} from "./modules/automations";
import {
  registerPulseIpc,
  pulseService,
  unregisterPulseIpc,
} from "./modules/pulse";
import { registerGuardsIpc, unregisterGuardsIpc } from "./modules/guards";
import {
  registerPullRequestsIpc,
  unregisterPullRequestsIpc,
} from "./modules/pullRequests";
import { imageProxyService } from "./modules/imageProxy/imageProxy.service";
import {
  registerImageProxyIpc,
  unregisterImageProxyIpc,
} from "./modules/imageProxy/imageProxy.ipc";
import {
  serveLocalImage,
  serveLocalDocument,
} from "./modules/imageProxy/imageProxy.local-serve";
import { tailscaleService } from "./modules/tailscale";
import { resolveWebRoot } from "./web-root";
import { registerSearchIpc, unregisterSearchIpc } from "./modules/search";
import type { PairingCode } from "./modules/backend";

export interface ServeOptions {
  /** Port to listen on. Default 8787. */
  port?: number;
  /** Interface to bind. Default loopback (127.0.0.1) — pair via SSH tunnel. */
  host?: string;
  /**
   * Owner token full-access clients must present. Falls back to MAINS_SERVE_TOKEN, then to
   * a freshly generated one that is printed. Never optional, loopback included:
   * any web page the user visits can open a WebSocket to 127.0.0.1.
   */
  token?: string | null;
  /**
   * Directory of the built renderer to serve over HTTP (web UI). Defaults to
   * `.vite/renderer`; web serving is skipped if it doesn't exist.
   */
  webRoot?: string | null;
  /**
   * Expose the backend over the tailnet's HTTPS endpoint via `tailscale serve`
   * (auto TLS, no port-forward). The backend still binds loopback; Tailscale
   * proxies tailnet → 127.0.0.1. Implies an owner token (tailnet peers can reach
   * it). Requires the `tailscale` CLI installed + logged in + HTTPS enabled.
   */
  tailscaleServe?: boolean;
  /** HTTPS port for `tailscale serve`. Default 443. */
  tailscaleServePort?: number;
}

export interface BackendServer extends WsHost {
  /** Full-access owner token accepted by the WebSocket host. */
  readonly token: string;
  /** HTTPS base URL installed by Tailscale Serve, when enabled successfully. */
  readonly tailscaleUrl: string | null;
  /** Mint a short-lived, single-use device pairing link in this process. */
  createPairingCode(endpoints: string[]): Promise<PairingCode>;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";

interface BackendRegistration {
  register(): void;
  unregister(): void;
}

const BACKEND_REGISTRATIONS: readonly BackendRegistration[] = [
  { register: registerAccountIpc, unregister: unregisterAccountIpc },
  { register: registerBackendIpc, unregister: unregisterBackendIpc },
  { register: registerSyncIpc, unregister: unregisterSyncIpc },
  { register: registerEntitiesHandlers, unregister: unregisterEntitiesHandlers },
  {
    register: registerConnectionsHandlers,
    unregister: unregisterConnectionsHandlers,
  },
  { register: registerSpaceIpc, unregister: unregisterSpaceIpc },
  { register: registerAppSettingsIpc, unregister: unregisterAppSettingsIpc },
  { register: registerProvidersIpc, unregister: unregisterProvidersIpc },
  { register: registerToolsIpc, unregister: unregisterToolsIpc },
  { register: registerWorkspaceIpc, unregister: unregisterWorkspaceIpc },
  { register: registerProjectsIpc, unregister: unregisterProjectsIpc },
  { register: registerCollectionsIpc, unregister: unregisterCollectionsIpc },
  { register: registerRunsIpc, unregister: unregisterRunsIpc },
  { register: registerFileExplorerIpc, unregister: unregisterFileExplorerIpc },
  { register: registerGitFlowIpc, unregister: unregisterGitFlowIpc },
  { register: registerTerminalIpc, unregister: unregisterTerminalIpc },
  { register: registerStatsIpc, unregister: unregisterStatsIpc },
  { register: registerAutomationsIpc, unregister: unregisterAutomationsIpc },
  { register: registerPulseIpc, unregister: unregisterPulseIpc },
  { register: registerGuardsIpc, unregister: unregisterGuardsIpc },
  {
    register: registerPullRequestsIpc,
    unregister: unregisterPullRequestsIpc,
  },
  { register: registerSearchIpc, unregister: unregisterSearchIpc },
  { register: registerImageProxyIpc, unregister: unregisterImageProxyIpc },
];

function unregisterBackendRegistrations(
  registrations: readonly BackendRegistration[],
): void {
  for (const registration of [...registrations].reverse()) {
    try {
      registration.unregister();
    } catch (error) {
      console.warn("[serve] failed to unregister a backend module", error);
    }
  }
}

/**
 * Boot the mains backend headlessly and serve it over WebSocket.
 *
 * Runs the same DB init + module registration as the Electron app but creates no
 * BrowserWindow: handlers are reached through the WebSocket host (which registers
 * a {@link WebSocketSink} for outbound events) instead of Electron IPC and
 * BrowserWindows. The `*.ipc.ts` modules register through the `ipcMain` shim, so
 * every migrated handler lands in the handler-registry the WS router invokes.
 *
 * The composition root must install a BackendRuntime first. The desktop uses
 * Electron capabilities; the standalone entry installs the plain-Node adapter.
 *
 * See docs/design/remote-backend.md.
 */
export async function startBackendServer(
  options: ServeOptions = {},
): Promise<BackendServer> {
  await initializeDatabase({
    verbose: false,
    enableWAL: true,
    busyTimeout: 5000,
  });

  const registered: BackendRegistration[] = [];
  try {
    for (const registration of BACKEND_REGISTRATIONS) {
      registration.register();
      registered.push(registration);
    }
    automationsService.start();
    pulseService.start();
  } catch (error) {
    automationsService.stop();
    pulseService.stop();
    unregisterBackendRegistrations(registered);
    await closeDatabase();
    throw error;
  }

  const host = options.host ?? DEFAULT_HOST;
  // Always token-gated, loopback included: a browser lets any web page open a
  // WebSocket to 127.0.0.1, so "loopback only" does not mean "only this user".
  const token = options.token || process.env.MAINS_SERVE_TOKEN || generateToken();

  const webRoot = resolveWebRoot(options.webRoot);

  let wsHost: WsHost;
  try {
    wsHost = await startWsHost({
      port: options.port ?? DEFAULT_PORT,
      host,
      token,
      webRoot,
      fetchProxiedImage: (url) => imageProxyService.proxyImage(url),
      serveLocalImage: (url) => serveLocalImage(url),
      serveLocalDocument: (url) => serveLocalDocument(url),
      verifyDeviceToken: (deviceToken) =>
        backendService.verifyDeviceToken(deviceToken),
      pairDevice: (body) => backendService.pairDevice(body),
      createPairingCode: (endpoints) =>
        backendService.createPairingCode(endpoints),
      listPairedDevices: () => backendService.listPairedDevices(),
      revokePairedDevice: async (deviceId) => {
        await backendService.revokePairedDevice(deviceId);
        wsHost?.disconnectDevice(deviceId);
      },
      commandReceipts: backendService.commandReceipts,
    });
  } catch (error) {
    automationsService.stop();
    pulseService.stop();
    unregisterBackendRegistrations(registered);
    await closeDatabase();
    throw error;
  }
  console.log(`[serve] mains backend listening on ws://${host}:${wsHost.port}`);
  console.log(`[serve] owner token: ${token}`);
  if (webRoot) {
    console.log(
      `[serve] web UI: open http://${host}:${wsHost.port}/?token=${token} (serving ${webRoot})`,
    );
  } else {
    console.log(
      "[serve] web UI disabled — no renderer build found. Run `npm run build:web` first.",
    );
  }

  let tailscaleUrl: string | null = null;
  if (options.tailscaleServe) {
    const httpsPort = options.tailscaleServePort ?? 443;
    try {
      await tailscaleService.startServe(wsHost.port, httpsPort);
      const status = await tailscaleService.readStatus();
      if (status.magicDnsName) {
        const httpsUrl = tailscaleService.resolveHttpsUrl(
          status.magicDnsName,
          httpsPort,
        );
        tailscaleUrl = httpsUrl;
        console.log(`[serve] Tailscale HTTPS web UI: ${httpsUrl}/?token=${token}`);
        console.log(
          `[serve] Tailscale connect (WS): ${httpsUrl.replace(/^https:/, "wss:")}`,
        );
      } else {
        console.log(
          "[serve] Tailscale serve started, but no MagicDNS name found (is Tailscale up / HTTPS enabled?).",
        );
      }
    } catch (error) {
      console.error(
        `[serve] Tailscale serve failed: ${
          error instanceof Error ? error.message : error
        }. Is the \`tailscale\` CLI installed, logged in, and HTTPS enabled for the tailnet?`,
      );
    }
  }

  let stopPromise: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      await wsHost.close();
      await tailscaleService.stopServeIfActive();
      automationsService.stop();
      pulseService.stop();
      runSessionRegistry.shutdownAll("Standalone server stopped during run");
      destroyAllTerminals();
      await shutdownAllWorkAdapters();
      unregisterBackendRegistrations(registered);
      await closeDatabase();
    })();
    return stopPromise;
  };

  return {
    sink: wsHost.sink,
    port: wsHost.port,
    token,
    tailscaleUrl,
    createPairingCode: (endpoints) =>
      backendService.createPairingCode(endpoints),
    disconnectDevice: (deviceId) => wsHost.disconnectDevice(deviceId),
    close,
  };
}
