import { shutdownUserDecisions } from "./modules/runs";
import { shutdownRecordLifecycles } from "./runtime/record-lifecycle";
import { createResourceLifecycle } from "./runtime/resource-lifecycle";
import DatabaseClient, { closeDatabase, initializeDatabase } from "./db/client";
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
  clearPairingCodes,
  registerBackendIpc,
  unregisterBackendIpc,
} from "./modules/backend";
import { registerSyncIpc, unregisterSyncIpc, shutdownSourceSync } from "./modules/sync";
import {
  registerEntitiesHandlers,
  unregisterEntitiesHandlers,
} from "./modules/entities";
import {
  registerConnectionsHandlers,
  shutdownConnections,
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
  shutdownWorkspaceIntakes,
  shutdownWorkspaceDiffs,
} from "./modules/workspace";
import { registerProjectsIpc, unregisterProjectsIpc } from "./modules/projects";
import {
  registerCollectionsIpc,
  unregisterCollectionsIpc,
} from "./modules/collections";
import { registerAtlasIpc, unregisterAtlasIpc, shutdownAtlasBookmarks } from "./modules/atlas";
import { registerRunsIpc, unregisterRunsIpc, startAttachmentMaintenance, stopAttachmentMaintenance } from "./modules/runs";
import { runSessionRegistry } from "./modules/runs/run-session-registry";
import {
  registerFileExplorerIpc,
  shutdownFileWrites,
  unregisterFileExplorerIpc,
} from "./modules/fileExplorer";
import { registerGitFlowIpc, unregisterGitFlowIpc, shutdownGitFlow } from "./modules/gitFlow";
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
import { bridgeService, registerBridgeIpc, unregisterBridgeIpc } from "./modules/bridge";

export interface ServeOptions {
  /** Cancel initialization or close this host when its owner is canceled. */
  signal?: AbortSignal;
  /** Port to listen on. Default 8787. */
  port?: number;
  /** Interface to bind. Default loopback (127.0.0.1) — pair via SSH tunnel. */
  host?: string;
  /**
   * Owner token full-access clients must present. Falls back to MAINS_SERVE_TOKEN,
   * then to a freshly generated one returned to the host for secure persistence.
   * It is never placed in a browser URL. Never optional, loopback included: any
   * web page the user visits can open a WebSocket to 127.0.0.1.
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
  unregister(): void | Promise<void>;
}

const BACKEND_REGISTRATIONS: readonly BackendRegistration[] = [
  { register: registerBridgeIpc, unregister: unregisterBridgeIpc },
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
  { register: registerAtlasIpc, unregister: unregisterAtlasIpc },
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

let activeBackend: object | undefined;

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
export function startBackendServer(options: ServeOptions = {}): Promise<BackendServer> {
  if (activeBackend || DatabaseClient.getInstance().isReady())
    return Promise.reject(new Error("A backend already owns this process; close it before starting another"));
  const lifecycle = createResourceLifecycle<BackendServer>("Backend server");
  activeBackend = lifecycle;
  return lifecycle.start(async (scope) => {
    scope.defer(() => { if (activeBackend === lifecycle) activeBackend = undefined; });
    scope.observe(options.signal);
    scope.defer(closeDatabase);
    await initializeDatabase({ verbose: false, enableWAL: true, busyTimeout: 5000 });
    scope.assertActive();
    scope.defer(async () => { await Promise.all([shutdownWorkspaceIntakes(), shutdownRecordLifecycles(), shutdownGitFlow(), shutdownFileWrites(), shutdownWorkspaceDiffs(), shutdownConnections(), shutdownSourceSync(), shutdownUserDecisions(), shutdownAtlasBookmarks()]); });
    scope.defer(async () => {
      runSessionRegistry.shutdownAll("Standalone server stopped during run");
      destroyAllTerminals();
      await shutdownAllWorkAdapters();
    });
    for (const registration of BACKEND_REGISTRATIONS) {
      // A registration may fail after installing some of its handlers.
      scope.defer(() => registration.unregister());
      registration.register();
      scope.assertActive();
    }
    scope.defer(() => bridgeService.stop());
    await bridgeService.start();
    scope.assertActive();
    const host = options.host ?? DEFAULT_HOST;
    const token = options.token || process.env.MAINS_SERVE_TOKEN || generateToken();
    const webRoot = resolveWebRoot(options.webRoot);
    const wsHost: WsHost = await startWsHost({
      port: options.port ?? DEFAULT_PORT,
      host,
      token,
      webRoot,
      fetchProxiedImage: (url) => imageProxyService.proxyImage(url),
      serveLocalImage: (url) => serveLocalImage(url),
      serveLocalDocument: (url) => serveLocalDocument(url),
      verifyDeviceToken: (deviceToken) =>
        backendService.verifyDeviceToken(deviceToken),
      retirePairingCodes: clearPairingCodes,
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
    scope.defer(() => wsHost.close());
    scope.defer(async () => { await Promise.all([shutdownWorkspaceIntakes(), shutdownRecordLifecycles(), shutdownGitFlow(), shutdownFileWrites(), shutdownWorkspaceDiffs(), shutdownConnections(), shutdownSourceSync(), shutdownUserDecisions(), shutdownAtlasBookmarks()]); });
    scope.assertActive();
    scope.defer(async () => { await Promise.all([automationsService.stop(), pulseService.stop()]); });
    automationsService.start();
    pulseService.start();
    console.log(`[serve] mains backend listening on ws://${host}:${wsHost.port}`);
    if (webRoot) console.log(`[serve] web UI ready at http://${host}:${wsHost.port}/ (serving ${webRoot})`);
    else console.log("[serve] web UI disabled — no renderer build found. Run `npm run build:web` first.");
    let tailscaleUrl: string | null = null;
    if (options.tailscaleServe) {
      const httpsPort = options.tailscaleServePort ?? 443;
      scope.defer(() => tailscaleService.stopServeIfActive());
      try {
        await tailscaleService.startServe(wsHost.port, httpsPort);
        scope.assertActive();
        const status = await tailscaleService.readStatus();
        scope.assertActive();
        if (status.magicDnsName) {
          tailscaleUrl = tailscaleService.resolveHttpsUrl(status.magicDnsName, httpsPort);
          console.log(`[serve] Tailscale HTTPS web UI: ${tailscaleUrl}/`);
          console.log(`[serve] Tailscale connect (WS): ${tailscaleUrl.replace(/^https:/, "wss:")}`);
        } else console.log("[serve] Tailscale serve started, but no MagicDNS name found (is Tailscale up / HTTPS enabled?).");
      } catch (error) {
        scope.assertActive();
        console.error(`[serve] Tailscale serve failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    scope.assertActive();
    scope.defer(() => stopAttachmentMaintenance());
    startAttachmentMaintenance();
    return {
      sink: wsHost.sink,
      port: wsHost.port,
      webUiAvailable: wsHost.webUiAvailable,
      token,
      tailscaleUrl,
      createWebLogin: (baseUrl) => wsHost.createWebLogin(baseUrl),
      createPairingCode: (endpoints) =>
        backendService.createPairingCode(endpoints),
      disconnectDevice: (deviceId) => wsHost.disconnectDevice(deviceId),
      connectedDeviceIds: () => wsHost.connectedDeviceIds(),
      close: () => lifecycle.close(),
    };
  });
}
