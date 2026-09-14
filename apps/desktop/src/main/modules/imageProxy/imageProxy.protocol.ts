import { app, protocol } from "electron";
import * as fs from "fs";
import * as path from "path";
import { imageProxyService, SsrfBlockedError } from "./imageProxy.service";
import {
  MAX_IMAGE_SIZE,
  serveLocalImage,
  serveLocalDocument,
} from "./imageProxy.local-serve";

/**
 * Bound concurrent upstream fetches. A grid of hundreds of remote images (e.g.
 * the plugins page) fires all its proxy requests at once; unbounded parallel
 * TLS connects to the same CDN get reset or time out (ECONNRESET /
 * UND_ERR_CONNECT_TIMEOUT). The slot is held for connection setup + headers —
 * body streaming reuses the established connection and is cheap.
 */
const MAX_CONCURRENT_REMOTE_FETCHES = 8;
let activeRemoteFetches = 0;
const remoteFetchQueue: Array<() => void> = [];

async function withRemoteFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRemoteFetches >= MAX_CONCURRENT_REMOTE_FETCHES) {
    await new Promise<void>((resolve) => remoteFetchQueue.push(resolve));
  }
  activeRemoteFetches++;
  try {
    return await fn();
  } finally {
    activeRemoteFetches--;
    remoteFetchQueue.shift()?.();
  }
}

function checkContentLength(response: Response): Response | null {
  const length = response.headers.get("content-length");
  if (length && parseInt(length, 10) > MAX_IMAGE_SIZE) {
    return new Response("Image too large", { status: 413 });
  }
  return null;
}

/**
 * Wrap `body` in a pass-through stream that aborts once cumulative bytes
 * exceed `maxBytes`. `Content-Length` alone is insufficient — servers can omit
 * it (chunked transfer) and a hostile/misconfigured host could feed us an
 * arbitrarily large payload that gets buffered into renderer memory.
 */
function enforceMaxBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): ReadableStream<Uint8Array> | null {
  if (!body) return body;

  let total = 0;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          // Cancel upstream and surface a stream error so the fetch caller
          // (and the renderer `<img>` tag) fails fast without buffering more.
          try {
            await reader.cancel("image too large");
          } catch {
            /* ignore */
          }
          controller.error(
            new Error(`image exceeds ${maxBytes} bytes (aborted at ${total})`),
          );
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {
        /* ignore */
      });
    },
  });
}

/**
 * Register the mains-img scheme as privileged.
 * MUST be called BEFORE app.ready.
 */
export function registerImageProxyScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "mains-img",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: "mains-capture",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: "mains-appicon",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: "mains-localimg",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: "mains-localdoc",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Shared helper to read a single PNG from a sandboxed directory. Prevents
 * path traversal by rejecting any name containing slashes or `..`. */
function serveLocalPng(baseDir: string, rawName: string): Response {
  if (!rawName || rawName.includes("..") || rawName.includes("/") || rawName.includes("\\")) {
    return new Response("Invalid filename", { status: 400 });
  }
  const filePath = path.join(baseDir, rawName);
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + path.sep)) {
    return new Response("Path escape denied", { status: 400 });
  }
  if (!fs.existsSync(resolved)) {
    return new Response("Not found", { status: 404 });
  }
  const data = fs.readFileSync(resolved);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/**
 * Register the protocol handler for mains-img:// URLs.
 * Must be called AFTER app.ready (inside initializeApp).
 */
export function registerImageProxyHandler() {
  // Serve browser capture PNGs from userData/browser-captures with path safety.
  protocol.handle("mains-capture", async (request) => {
    try {
      const requestUrl = new URL(request.url);
      // mains-capture://<host-ignored>/<filename>
      const raw = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ""));
      const baseDir = path.join(app.getPath("userData"), "browser-captures");
      return serveLocalPng(baseDir, raw);
    } catch (error) {
      console.error("[mains-capture] handler error:", error);
      return new Response("Capture proxy error", { status: 500 });
    }
  });

  // Serve cached application icons from userData/app-icons. The main process
  // writes `${id}.png` for each detected installed app during
  // `detectInstalledApps()` and the renderer references them via
  // `mains-appicon://icon/<id>.png` — no base64 blobs in memory.
  protocol.handle("mains-appicon", async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const raw = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ""));
      const baseDir = path.join(app.getPath("userData"), "app-icons");
      return serveLocalPng(baseDir, raw);
    } catch (error) {
      console.error("[mains-appicon] handler error:", error);
      return new Response("App icon error", { status: 500 });
    }
  });

  protocol.handle("mains-localimg", async (request) => {
    try {
      const requestUrl = new URL(request.url);
      return await serveLocalImage(requestUrl);
    } catch (error) {
      console.error("[mains-localimg] handler error:", error);
      return new Response("Local image proxy error", { status: 500 });
    }
  });

  protocol.handle("mains-localdoc", async (request) => {
    try {
      const requestUrl = new URL(request.url);
      return await serveLocalDocument(requestUrl);
    } catch (error) {
      console.error("[mains-localdoc] handler error:", error);
      return new Response("Local document proxy error", { status: 500 });
    }
  });

    protocol.handle("mains-img", async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const originalUrl = requestUrl.searchParams.get("url");

      if (!originalUrl) {
        return new Response("Missing url parameter", { status: 400 });
      }

      // Validate it's a real URL
      let parsed: URL;
      try {
        parsed = new URL(originalUrl);
      } catch {
        return new Response("Invalid url parameter", { status: 400 });
      }

      // Only proxy http(s) URLs
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return new Response("Only HTTP(S) URLs are supported", { status: 400 });
      }

      // GitHub: authenticated fetch (SSRF-guarded, auth dropped on redirect)
      if (imageProxyService.matchUrlToGithub(originalUrl)) {
        const headers = await imageProxyService.buildGithubAuthHeaders();
        if (headers) {
          const response = await withRemoteFetchSlot(() =>
            imageProxyService.safeImageFetch(originalUrl, headers),
          );

          const tooLarge = checkContentLength(response);
          if (tooLarge) return tooLarge;

          return new Response(
            enforceMaxBytes(response.body, MAX_IMAGE_SIZE),
            {
              status: response.status,
              headers: {
                "Content-Type":
                  response.headers.get("content-type") ||
                  "application/octet-stream",
                "Cache-Control": "private, max-age=3600",
              },
            },
          );
        }
      }

      // Everything else — SSRF-guarded passthrough (no auth)
      const response = await withRemoteFetchSlot(() =>
        imageProxyService.safeImageFetch(originalUrl, null),
      );
      const tooLarge = checkContentLength(response);
      if (tooLarge) return tooLarge;

      return new Response(enforceMaxBytes(response.body, MAX_IMAGE_SIZE), {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        // Target resolved to a private/loopback/link-local address (or wasn't
        // a valid http(s) URL). Refuse rather than fetch internal endpoints.
        return new Response("Forbidden", { status: 403 });
      }
      const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
      console.error(
        `[imageProxy] Protocol handler error${causeCode ? ` (${causeCode})` : ""}:`,
        (error as Error)?.message ?? error,
      );
      return new Response("Image proxy error", { status: 500 });
    }
  });
}
