import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import {
  WS_SUBPROTOCOL,
  extractToken,
  parseProtocolHeader,
} from "@mains/contracts/ws-protocol";
import { registerEventSink } from "./event-bus";
import { tokensMatch } from "./ws-auth";
import {
  createWebSessionManager,
  type WebLoginLink,
  type WebSessionManager,
} from "./web-session";
export type { WebLoginLink } from "./web-session";
import { WebSocketSink } from "./websocket-sink";
import {
  serveConnection,
  type CommandReceiptStore,
  type WsConnection,
} from "./ws-server";

/** A device token the host accepted at the handshake. */
export interface VerifiedDevice {
  deviceId: string;
  /** Channels the device may invoke; undefined = everything the owner token can. */
  channels?: ReadonlySet<string>;
  /** Mutations the device may issue, each only with a `commandId`. */
  commandChannels?: ReadonlySet<string>;
  /** Events pushed to the device; undefined = everything on the bus. */
  eventChannels?: ReadonlySet<string>;
}

export interface WsHost {
  readonly sink: WebSocketSink;
  /** The actual listening port (resolved even when started with port 0). */
  readonly port: number;
  /** Whether this host found a built renderer it can serve to browsers. */
  readonly webUiAvailable: boolean;
  /** Mint an origin-bound, five-minute, single-use browser login link. */
  createWebLogin(baseUrl: string): WebLoginLink;
  /**
   * Drop every live connection authenticated as this paired device. Device
   * tokens are checked only at the handshake, so revoking one without this
   * leaves an already-open socket working. Returns how many were dropped.
   */
  disconnectDevice(deviceId: string): number;
  /** Paired devices holding at least one open socket right now. */
  connectedDeviceIds(): Set<string>;
  close(): Promise<void>;
}

export interface WsHostOptions {
  port: number;
  host?: string;
  /**
   * Owner token clients must present (via WS subprotocol); the handshake is
   * rejected (401) unless it matches. Required on every bind, loopback included:
   * a browser lets any web page open a WebSocket to 127.0.0.1, so a tokenless
   * loopback host is reachable from every site the user visits.
   */
  token: string;
  /**
   * Directory of the built renderer to serve over HTTP on the same port (so a
   * browser can load the web UI from the backend). When unset, only WS is served.
   */
  webRoot?: string | null;
  /**
   * Remote-image proxy for web mode — `GET /__img?url=<encoded>` pipes the result.
   * Lets a browser load remote images (avatars etc.) the way the Electron
   * `mains-img://` protocol does. Requests authenticate with the cookie set by
   * `POST /__mains/web-session`. Injected to keep this module domain-agnostic.
   */
  fetchProxiedImage?: (url: string) => Promise<Response>;
  /**
   * Signed local-image server for web mode — `GET /__localimg?path&exp&sig` mirrors
   * the Electron `mains-localimg://` protocol (HMAC-signed, same secret/process).
   * Injected to keep this module domain-agnostic.
   */
  serveLocalImage?: (url: URL) => Promise<Response>;
  /** Signed local-document server — `GET /__localdoc?…`; mirrors `mains-localdoc://`. */
  serveLocalDocument?: (url: URL) => Promise<Response>;
  /**
   * Authenticate a paired device's token (see modules/backend). Consulted only
   * when the presented token is not the shared one. Resolves the device on
   * success, null otherwise.
   */
  verifyDeviceToken?: (token: string) => Promise<VerifiedDevice | null>;
  /**
   * Exchange a one-time pairing code for a device token — `POST /pair` with a
   * JSON body. Unauthenticated by design (the code IS the credential). The
   * handler validates and throws; the host replies 400 with the message.
   */
  pairDevice?: (body: unknown) => Promise<unknown>;
  /**
   * Mint a one-time pairing code for a trusted local administrator. The
   * standalone CLI calls this over the token-authenticated control route so
   * the code is created inside the already-running server process.
   */
  createPairingCode?: (endpoints: string[]) => Promise<unknown>;
  /** List device sessions for authenticated local administration. */
  listPairedDevices?: () => Promise<unknown>;
  /** Revoke one device session for authenticated local administration. */
  revokePairedDevice?: (deviceId: string) => Promise<void>;
  /**
   * A paired device's socket opened or closed. Fires after
   * {@link WsHost.connectedDeviceIds} already reflects the change, so a
   * listener can read it straight away.
   */
  onDeviceConnectionChange?: (deviceId: string) => void;
  /**
   * Receipt store that makes a paired device's commands idempotent: a repeated
   * `commandId` replays the stored result instead of running the handler
   * again. Without it, device commands run every time they arrive.
   */
  commandReceipts?: CommandReceiptStore;
}

const MAX_PROXY_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PAIR_BODY_BYTES = 16 * 1024;
const MAX_PAIRING_ENDPOINTS = 8;
const WEB_SESSION_PATH = "/__mains/web-session";
const WEB_SESSION_COOKIE_PATH = "/__mains";
const IMAGE_COOKIE_PATH = "/__img";

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end(JSON.stringify(payload));
}

function bearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (!raw || Array.isArray(raw)) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1] ?? null;
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function requestOrigin(req: IncomingMessage): string | null {
  const raw = req.headers.origin;
  if (!raw || Array.isArray(raw)) return null;
  try {
    const origin = new URL(raw);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") return null;
    return origin.origin;
  } catch {
    return null;
  }
}

/** Origin of the document initiating a same-origin subresource request. */
function requestDocumentOrigin(req: IncomingMessage): string | null {
  const origin = requestOrigin(req);
  if (origin) return origin;
  const raw = req.headers.referer;
  if (!raw || Array.isArray(raw)) return null;
  try {
    const referrer = new URL(raw);
    if (referrer.protocol !== "http:" && referrer.protocol !== "https:") {
      return null;
    }
    return referrer.origin;
  } catch {
    return null;
  }
}

function serializeSessionCookie(params: {
  name: string;
  value: string;
  path: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string {
  return (
    `${params.name}=${params.value}; Path=${params.path}; HttpOnly; ` +
    `SameSite=Strict; Max-Age=${params.maxAgeSeconds}` +
    (params.secure ? "; Secure" : "")
  );
}

function parsePairingEndpoints(body: unknown): string[] {
  if (!body || typeof body !== "object") {
    throw new Error("Pairing request must be an object");
  }
  const raw = (body as { endpoints?: unknown }).endpoints;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("At least one reachable endpoint is required");
  }
  if (raw.length > MAX_PAIRING_ENDPOINTS) {
    throw new Error(`At most ${MAX_PAIRING_ENDPOINTS} endpoints may be advertised`);
  }

  const endpoints: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") {
      throw new Error("Every pairing endpoint must be an HTTP(S) URL");
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid pairing endpoint: ${value}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Pairing endpoint must use HTTP or HTTPS: ${value}`);
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(`Pairing endpoint must be a base URL: ${value}`);
    }
    const normalized = url.toString().replace(/\/$/, "");
    if (!endpoints.includes(normalized)) endpoints.push(normalized);
  }
  return endpoints;
}

function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function handlePairing(
  req: IncomingMessage,
  res: ServerResponse,
  pairDevice: (body: unknown) => Promise<unknown>,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_PAIR_BODY_BYTES);
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request",
    });
    return;
  }
  try {
    writeJson(res, 200, await pairDevice(body));
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Pairing failed",
    });
  }
}

async function handleCreatePairingCode(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  createPairingCode: (endpoints: string[]) => Promise<unknown>,
): Promise<void> {
  if (!tokensMatch(token, bearerToken(req))) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_PAIR_BODY_BYTES);
    const endpoints = parsePairingEndpoints(body);
    writeJson(res, 200, await createPairingCode(endpoints));
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Pairing code creation failed",
    });
  }
}

async function handleCreateWebLogin(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  createWebLogin: (baseUrl: string) => WebLoginLink,
): Promise<void> {
  if (!tokensMatch(token, bearerToken(req))) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const body = await readJsonBody(req, MAX_PAIR_BODY_BYTES);
    const baseUrl =
      body && typeof body === "object"
        ? (body as { baseUrl?: unknown }).baseUrl
        : undefined;
    if (typeof baseUrl !== "string") {
      throw new Error("Browser login request requires a baseUrl");
    }
    writeJson(res, 200, createWebLogin(baseUrl));
  } catch (error) {
    writeJson(res, 400, {
      error: error instanceof Error ? error.message : "Browser login creation failed",
    });
  }
}

async function handleListPairedDevices(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  listPairedDevices: () => Promise<unknown>,
): Promise<void> {
  if (!tokensMatch(token, bearerToken(req))) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }
  try {
    writeJson(res, 200, await listPairedDevices());
  } catch (error) {
    writeJson(res, 500, {
      error: error instanceof Error ? error.message : "Could not list devices",
    });
  }
}

async function handleRevokePairedDevice(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  deviceId: string,
  revokePairedDevice: (deviceId: string) => Promise<void>,
): Promise<void> {
  if (!tokensMatch(token, bearerToken(req))) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }
  try {
    await revokePairedDevice(deviceId);
    writeJson(res, 200, { revoked: true });
  } catch (error) {
    writeJson(res, 404, {
      error: error instanceof Error ? error.message : "Could not revoke device",
    });
  }
}

/** Proxied images and signed local files are untrusted active content. */
const UNTRUSTED_CONTENT_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
};

/** Pipe a Web `Response` (from the signed local-file servers) to the Node res. */
async function handleLocalFile(
  req: IncomingMessage,
  res: ServerResponse,
  serve: (url: URL) => Promise<Response>,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const response = await serve(url);
    const body = Buffer.from(await response.arrayBuffer());
    const headers: Record<string, string> = {
      ...UNTRUSTED_CONTENT_HEADERS,
      "Content-Type":
        response.headers.get("content-type") ?? "application/octet-stream",
    };
    const cache = response.headers.get("cache-control");
    if (cache) headers["Cache-Control"] = cache;
    res.writeHead(response.status, headers);
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end("Local file error");
  }
}

/** Spend a browser login code for origin-bound WS and image-proxy cookies. */
function handleWebSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: WebSessionManager,
): void {
  const credentials = sessions.exchange(bearerToken(req), requestOrigin(req));
  if (!credentials) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }
  const maxAgeSeconds = Math.max(
    1,
    Math.floor((credentials.expiresAt - Date.now()) / 1000),
  );
  res.writeHead(204, {
    "Set-Cookie": [
      serializeSessionCookie({
        name: sessions.sessionCookieName,
        value: credentials.sessionToken,
        path: WEB_SESSION_COOKIE_PATH,
        maxAgeSeconds,
        secure: credentials.secure,
      }),
      serializeSessionCookie({
        name: sessions.imageCookieName,
        value: credentials.imageToken,
        path: IMAGE_COOKIE_PATH,
        maxAgeSeconds,
        secure: credentials.secure,
      }),
    ],
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end();
}

async function handleImageProxy(
  req: IncomingMessage,
  res: ServerResponse,
  fetchProxiedImage: (url: string) => Promise<Response>,
  sessions: WebSessionManager,
): Promise<void> {
  try {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    // The proxy spends this machine's network position and its GitHub token, so
    // it needs the web client's image-proxy cookie. Paired phones don't use it.
    if (
      !sessions.verifyImageSession(
        readCookie(req, sessions.imageCookieName),
        requestDocumentOrigin(req),
      )
    ) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
    const target = params.get("url");
    if (!target) {
      res.writeHead(400);
      res.end("Missing url");
      return;
    }
    const response = await fetchProxiedImage(target);
    const length = response.headers.get("content-length");
    if (length && Number(length) > MAX_PROXY_IMAGE_BYTES) {
      res.writeHead(413);
      res.end("Too large");
      return;
    }
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      ...UNTRUSTED_CONTENT_HEADERS,
      "Content-Type":
        response.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    });
    res.end(body);
  } catch {
    res.writeHead(502);
    res.end("Image proxy error");
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

/**
 * Minimal static file server for the built renderer. The app uses HashRouter, so
 * routes live in the URL hash — any non-asset request falls back to index.html.
 * Path traversal is prevented by resolving within `webRoot`.
 */
function createStaticHandler(webRoot: string) {
  const root = path.resolve(webRoot);
  const indexPath = path.join(root, "index.html");
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const resolved = path.resolve(root, `.${urlPath}`);
      const relative = path.relative(root, resolved);
      const isInsideRoot =
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative));
      const isAsset =
        isInsideRoot &&
        existsSync(resolved) &&
        statSync(resolved).isFile();
      const filePath = isAsset ? resolved : indexPath;
      const body = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  };
}

/**
 * Start the headless host for `mains serve`:
 *  - register a {@link WebSocketSink} so event-bus events fan out to clients,
 *  - accept WS connections and route each one's `invoke` frames through the
 *    handler-registry (via {@link serveConnection}),
 *  - optionally serve the built renderer over HTTP on the same port, so a browser
 *    can load the web UI from the backend.
 *
 * The thin {@link adaptSocket} layer is the only place that touches the `ws`
 * library; all logic lives in the transport-agnostic {@link serveConnection}.
 * See docs/design/remote-backend.md.
 */
export function startWsHost(options: WsHostOptions): Promise<WsHost> {
  const token = options.token;
  // Checked at runtime too: an empty string type-checks and would open the host.
  if (!token) {
    return Promise.reject(
      new Error("Refusing to start the backend without an owner token."),
    );
  }

  const requestedWebRoot = options.webRoot
    ? path.resolve(options.webRoot)
    : null;
  const webRoot =
    requestedWebRoot && existsSync(path.join(requestedWebRoot, "index.html"))
      ? requestedWebRoot
      : null;
  const staticHandler = webRoot ? createStaticHandler(webRoot) : null;
  const webSessions = createWebSessionManager();
  const createWebLogin = (baseUrl: string): WebLoginLink => {
    if (!webRoot) throw new Error("Web UI is not available on this backend");
    return webSessions.createLogin(baseUrl);
  };

  const httpServer: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    if (
      options.pairDevice &&
      req.method === "POST" &&
      pathname === "/pair"
    ) {
      void handlePairing(req, res, options.pairDevice);
    } else if (
      options.createPairingCode &&
      req.method === "POST" &&
      pathname === "/__mains/admin/pairing-code"
    ) {
      void handleCreatePairingCode(
        req,
        res,
        token,
        options.createPairingCode,
      );
    } else if (
      req.method === "POST" &&
      pathname === "/__mains/admin/web-login"
    ) {
      void handleCreateWebLogin(req, res, token, createWebLogin);
    } else if (
      options.listPairedDevices &&
      req.method === "GET" &&
      pathname === "/__mains/admin/devices"
    ) {
      void handleListPairedDevices(
        req,
        res,
        token,
        options.listPairedDevices,
      );
    } else if (
      options.revokePairedDevice &&
      req.method === "DELETE" &&
      pathname.startsWith("/__mains/admin/devices/")
    ) {
      const rawId = pathname.slice("/__mains/admin/devices/".length);
      let deviceId = "";
      try {
        deviceId = decodeURIComponent(rawId);
      } catch {
        writeJson(res, 400, { error: "Invalid device id" });
        return;
      }
      if (!deviceId || deviceId.includes("/")) {
        writeJson(res, 400, { error: "Invalid device id" });
        return;
      }
      void handleRevokePairedDevice(
        req,
        res,
        token,
        deviceId,
        options.revokePairedDevice,
      );
    } else if (
      req.method === "POST" &&
      pathname === WEB_SESSION_PATH
    ) {
      handleWebSession(req, res, webSessions);
    } else if (
      options.fetchProxiedImage &&
      req.method === "GET" &&
      pathname === IMAGE_COOKIE_PATH
    ) {
      void handleImageProxy(req, res, options.fetchProxiedImage, webSessions);
    } else if (options.serveLocalImage && url.startsWith("/__localimg")) {
      void handleLocalFile(req, res, options.serveLocalImage);
    } else if (options.serveLocalDocument && url.startsWith("/__localdoc")) {
      void handleLocalFile(req, res, options.serveLocalDocument);
    } else if (staticHandler) {
      void staticHandler(req, res);
    } else {
      res.writeHead(426);
      res.end("Upgrade Required");
    }
  });

  const sink = new WebSocketSink();
  const unregisterSink = registerEventSink(sink);

  // Device identity survives from the handshake to the `connection` event via
  // the request object, which `ws` hands to both.
  const authenticatedDevices = new WeakMap<IncomingMessage, VerifiedDevice>();
  const authenticatedWebSessions = new WeakMap<IncomingMessage, number>();
  const authorize = async (req: IncomingMessage): Promise<boolean> => {
    const raw = req.headers["sec-websocket-protocol"];
    const header = Array.isArray(raw) ? raw.join(",") : raw;
    const presented = extractToken(parseProtocolHeader(header));
    if (tokensMatch(token, presented)) return true;
    if (presented && options.verifyDeviceToken) {
      const device = await options.verifyDeviceToken(presented).catch(() => null);
      if (device) {
        authenticatedDevices.set(req, device);
        return true;
      }
    }
    // The request target is attacker-controlled: `new URL("//", base)` throws,
    // so compare the raw path instead of parsing it.
    const requestPath = (req.url ?? "/").split("?")[0];
    const webSession =
      requestPath === "/__mains/ws"
        ? webSessions.verifySession(
            readCookie(req, webSessions.sessionCookieName),
            requestOrigin(req),
          )
        : null;
    if (webSession) {
      authenticatedWebSessions.set(req, webSession.expiresAt);
      return true;
    }
    return false;
  };

  const wss = new WebSocketServer({
    server: httpServer,
    // Echo the base subprotocol; the token subprotocol is validated, not echoed.
    handleProtocols: (protocols) =>
      protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false,
    // Reject the handshake (401) when the token is missing or wrong, so an
    // unauthenticated socket never opens.
    verifyClient: (info, cb) => {
      // Fail closed: a throw while authenticating must reject this handshake,
      // never surface as an unhandled rejection that takes the process down.
      void authorize(info.req)
        .catch(() => false)
        .then((allowed) => {
          if (allowed) cb(true);
          else cb(false, 401, "Unauthorized");
        });
    },
  });

  // Which paired device each open socket belongs to, for disconnectDevice.
  const socketDevices = new WeakMap<WebSocket, string>();
  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const device = authenticatedDevices.get(req);
    if (device) {
      socketDevices.set(socket, device.deviceId);
      // `ws` drops a socket from `wss.clients` in a close listener it adds
      // before emitting "connection", so by the time this one runs the
      // socket no longer counts as connected.
      socket.once("close", () =>
        options.onDeviceConnectionChange?.(device.deviceId),
      );
      options.onDeviceConnectionChange?.(device.deviceId);
    }
    const webSessionExpiresAt = authenticatedWebSessions.get(req);
    if (webSessionExpiresAt !== undefined) {
      const expiryTimer = setTimeout(
        () => socket.terminate(),
        Math.max(0, webSessionExpiresAt - Date.now()),
      );
      socket.once("close", () => clearTimeout(expiryTimer));
    }
    serveConnection(adaptSocket(socket, device), sink, {
      commandReceipts: options.commandReceipts,
    });
  });

  return new Promise<WsHost>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      const address = httpServer.address();
      const port =
        typeof address === "object" && address ? address.port : options.port;
      resolve({
        sink,
        port,
        webUiAvailable: webRoot !== null,
        createWebLogin,
        disconnectDevice: (deviceId) => {
          let dropped = 0;
          for (const client of wss.clients) {
            if (socketDevices.get(client) !== deviceId) continue;
            // terminate, not close: a close handshake leaves the socket readable
            // until the peer answers, and a revoked device need not answer.
            client.terminate();
            dropped++;
          }
          return dropped;
        },
        connectedDeviceIds: () => {
          const ids = new Set<string>();
          for (const client of wss.clients) {
            const deviceId = socketDevices.get(client);
            if (deviceId && client.readyState === client.OPEN) ids.add(deviceId);
          }
          return ids;
        },
        close: () =>
          new Promise<void>((res) => {
            unregisterSink();
            webSessions.clear();
            // Force live connections closed first. httpServer.close() waits for
            // active sockets to drain, and wss.close() does NOT terminate its
            // clients — so a single connected WS client (the normal case for an
            // exposed backend) would otherwise hang every rebind/teardown/shutdown.
            for (const client of wss.clients) client.terminate();
            wss.close(() => {
              httpServer.close(() => res());
              httpServer.closeAllConnections?.();
            });
          }),
      });
    });
  });
}

function adaptSocket(socket: WebSocket, device?: VerifiedDevice): WsConnection {
  return {
    id: randomUUID(),
    deviceId: device?.deviceId,
    allowedChannels: device?.channels,
    commandChannels: device?.commandChannels,
    eventChannels: device?.eventChannels,
    send: (data) => socket.send(data),
    onMessage: (listener) =>
      socket.on("message", (raw: RawData, isBinary: boolean) => {
        if (!isBinary) listener(raw.toString());
      }),
    onClose: (listener) => socket.on("close", () => listener()),
  };
}
