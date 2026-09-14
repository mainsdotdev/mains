import { initializeDatabase } from "./db/client";
import { startWsHost, type WsHost } from "./ipc-kit/ws-server-host";
import { generateToken } from "./ipc-kit/ws-auth";

// Backend IPC registrations — the same handlers the Electron app registers (see
// src/main/index.ts), now reachable over WebSocket. Keep this list in sync with
// index.ts. Renderer-/shell-only modules are intentionally omitted from the
// headless backend: browser (drives a local BrowserView), imageProxy (custom
// protocol serving a local renderer), and updates (app self-update).
import { registerAccountIpc } from "./modules/account";
import { backendService, registerBackendIpc } from "./modules/backend";
import { registerSyncIpc } from "./modules/sync";
import { registerEntitiesHandlers } from "./modules/entities";
import { registerConnectionsHandlers } from "./modules/connections";
import { registerSpaceIpc } from "./modules/space";
import { registerAppSettingsIpc } from "./modules/appSettings";
import { registerProvidersIpc } from "./modules/providers";
import { registerToolsIpc } from "./modules/tools";
import { registerWorkspaceIpc } from "./modules/workspace";
import { registerProjectsIpc } from "./modules/projects";
import { registerCollectionsIpc } from "./modules/collections";
import { registerRunsIpc } from "./modules/runs";
import { registerFileExplorerIpc } from "./modules/fileExplorer";
import { registerGitFlowIpc } from "./modules/gitFlow";
import { registerTerminalIpc } from "./modules/terminal";
import { registerStatsIpc } from "./modules/stats";
import {
  registerAutomationsIpc,
  automationsService,
} from "./modules/automations";
import { registerPulseIpc, pulseService } from "./modules/pulse";
import { registerGuardsIpc } from "./modules/guards";
import { imageProxyService } from "./modules/imageProxy/imageProxy.service";
import {
  registerImageProxyIpc,
  serveLocalImage,
  serveLocalDocument,
} from "./modules/imageProxy";
import { tailscaleService } from "./modules/tailscale";
import { resolveWebRoot } from "./web-root";

export interface ServeOptions {
  /** Port to listen on. Default 8787. */
  port?: number;
  /** Interface to bind. Default loopback (127.0.0.1) — pair via SSH tunnel. */
  host?: string;
  /**
   * Pairing token clients must present. Falls back to MAINS_SERVE_TOKEN, then to
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
   * proxies tailnet → 127.0.0.1. Implies a pairing token (tailnet peers can reach
   * it). Requires the `tailscale` CLI installed + logged in + HTTPS enabled.
   */
  tailscaleServe?: boolean;
  /** HTTPS port for `tailscale serve`. Default 443. */
  tailscaleServePort?: number;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";

/**
 * Boot the mains backend headlessly and serve it over WebSocket.
 *
 * Runs the same DB init + module registration as the Electron app but creates no
 * BrowserWindow: handlers are reached through the WebSocket host (which registers
 * a {@link WebSocketSink} for outbound events) instead of Electron IPC and
 * BrowserWindows. The `*.ipc.ts` modules register through the `ipcMain` shim, so
 * every migrated handler lands in the handler-registry the WS router invokes.
 *
 * MUST run inside an Electron main process — the backend uses Electron APIs
 * (`app.getPath` for the DB path, `safeStorage` for credentials). Launch it as a
 * headless Electron entry (e.g. `electron . --serve`) after `app.whenReady()`.
 *
 * See docs/design/remote-backend.md.
 */
export async function startBackendServer(
  options: ServeOptions = {},
): Promise<WsHost> {
  await initializeDatabase({
    verbose: false,
    enableWAL: true,
    busyTimeout: 5000,
  });

  registerAccountIpc();
  registerBackendIpc();
  registerSyncIpc();
  registerEntitiesHandlers();
  registerConnectionsHandlers();
  registerSpaceIpc();
  registerAppSettingsIpc();
  registerProvidersIpc();
  registerToolsIpc();
  registerWorkspaceIpc();
  registerProjectsIpc();
  registerCollectionsIpc();
  registerRunsIpc();
  registerFileExplorerIpc();
  registerGitFlowIpc();
  registerTerminalIpc();
  registerStatsIpc();
  registerAutomationsIpc();
  registerPulseIpc();
  registerGuardsIpc();
  // sign-only: the HMAC signing IPC (imageProxy:sign / documents:sign). The
  // Electron custom-protocol handler isn't registered here — web mode serves the
  // signed paths over HTTP (/__localimg, /__localdoc) instead.
  registerImageProxyIpc();

  automationsService.start();
  pulseService.start();

  const host = options.host ?? DEFAULT_HOST;
  // Always token-gated, loopback included: a browser lets any web page open a
  // WebSocket to 127.0.0.1, so "loopback only" does not mean "only this user".
  const token = options.token || process.env.MAINS_SERVE_TOKEN || generateToken();

  const webRoot = resolveWebRoot(options.webRoot);

  const wsHost = await startWsHost({
    port: options.port ?? DEFAULT_PORT,
    host,
    token,
    webRoot,
    fetchProxiedImage: (url) => imageProxyService.proxyImage(url),
    serveLocalImage: (url) => serveLocalImage(url),
    serveLocalDocument: (url) => serveLocalDocument(url),
    // Phones paired through the desktop app share this machine's DB, so their
    // device tokens work against the headless host too.
    verifyDeviceToken: (deviceToken) =>
      backendService.verifyDeviceToken(deviceToken),
    pairDevice: (body) => backendService.pairDevice(body),
    commandReceipts: backendService.commandReceipts,
  });
  console.log(`[serve] mains backend listening on ws://${host}:${wsHost.port}`);
  console.log(`[serve] pairing token: ${token}`);
  if (webRoot) {
    console.log(
      `[serve] web UI: open http://${host}:${wsHost.port}/?token=${token} (serving ${webRoot})`,
    );
  } else {
    console.log(
      "[serve] web UI disabled — no renderer build found. Run `npm run build:web` first.",
    );
  }

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

  return wsHost;
}
