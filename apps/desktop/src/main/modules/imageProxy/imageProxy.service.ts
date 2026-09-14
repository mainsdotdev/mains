import * as os from "os";
import * as path from "path";
import * as dns from "dns";
import { getConnectionWithSecrets } from "../connections";
import { signLocalImagePath, signLocalDocumentPath } from "./imageProxy.signing";

// ─────────────────────────────────────────────────────────────
// Domain Map
// ─────────────────────────────────────────────────────────────
const GITHUB_DOMAINS = ["githubusercontent.com", "github.com"];
/** GitHub hosts that serve data, never images — the token is not sent there. */
const GITHUB_API_HOSTS = new Set(["api.github.com", "uploads.github.com"]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

const DOCUMENT_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"]);

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ─────────────────────────────────────────────────────────────
// SSRF Guard
// ─────────────────────────────────────────────────────────────
/** Thrown when a proxied URL targets a non-public (private/loopback/etc.) address. */
export class SsrfBlockedError extends Error {}

const MAX_REDIRECTS = 5;

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  ) {
    return true; // unparseable → fail closed
  }
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const v4mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4mapped) return isBlockedIpv4(v4mapped[1]);
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/**
 * Reject anything that isn't a public http(s) destination. Resolves the host
 * and checks every returned address, so a domain that resolves to a private IP
 * is blocked too. NOTE: a small resolve-then-fetch TOCTOU (DNS-rebinding)
 * window remains — acceptable for this single-user desktop threat model.
 */
async function assertUrlAllowed(urlStr: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new SsrfBlockedError("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SsrfBlockedError("only http(s) urls are allowed");
  }
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  let addrs: { address: string }[];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new SsrfBlockedError(`dns resolution failed for ${host}`);
  }
  if (addrs.length === 0) throw new SsrfBlockedError(`no addresses for ${host}`);
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      throw new SsrfBlockedError(`blocked address ${address}`);
    }
  }
}

/** `image/png`, `image/svg+xml`, … — the media type only, parameters ignored. */
export function isImageContentType(contentType: string | null): boolean {
  return /^image\/[a-z0-9.+-]+$/i.test((contentType ?? "").split(";")[0].trim());
}

/**
 * This is an image proxy, not a fetch proxy: a response that is not an image
 * leaves with its status and no body. With the GitHub token attached, anything
 * else — API JSON, a private repo's `.env` on raw.githubusercontent.com — would
 * be that repo's content handed to whoever asked for the URL.
 */
function onlyImages(response: Response): Response {
  if (isImageContentType(response.headers.get("content-type"))) return response;
  void response.body?.cancel().catch(() => {});
  return new Response(null, { status: response.ok ? 415 : response.status });
}

// ─────────────────────────────────────────────────────────────
// Image Proxy Service
// ─────────────────────────────────────────────────────────────
export const imageProxyService = {
  /**
   * Returns a signed `mains-localimg://` URL the renderer can drop straight
   * into an `<img>` tag. Validates extension cheaply — does not stat the file,
   * since the protocol handler will do that and return 404 if it's missing.
   * The HMAC signature is what authorizes the path, so the policy applied
   * here is the *only* policy enforced at request time.
   */
  signLocalImageUrl(rawPath: string, ttlMs?: number): string | null {
    if (typeof rawPath !== "string" || rawPath.length === 0) return null;
    const expanded = expandTilde(rawPath);
    if (!path.isAbsolute(expanded)) return null;
    const resolved = path.resolve(expanded);
    if (resolved.includes("\0")) return null;
    const ext = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return null;
    return signLocalImagePath(resolved, ttlMs);
  },

  /**
   * Returns a signed `mains-localdoc://` URL the renderer can `fetch()` to get
   * the raw bytes of an Office document. Mirrors {@link signLocalImageUrl} but
   * with an Office-extension allowlist. The HMAC signature authorizes the path;
   * the protocol handler re-stats the file (symlink/size/mime guards).
   */
  signLocalDocumentUrl(rawPath: string, ttlMs?: number): string | null {
    if (typeof rawPath !== "string" || rawPath.length === 0) return null;
    const expanded = expandTilde(rawPath);
    if (!path.isAbsolute(expanded)) return null;
    const resolved = path.resolve(expanded);
    if (resolved.includes("\0")) return null;
    const ext = path.extname(resolved).toLowerCase();
    if (!DOCUMENT_EXTENSIONS.has(ext)) return null;
    return signLocalDocumentPath(resolved, ttlMs);
  },

  matchUrlToGithub(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (GITHUB_API_HOSTS.has(hostname)) return false;
      // Exact host or a dot-bounded subdomain only — never a lookalike like
      // "evilgithub.com" that merely *ends with* "github.com" (which would
      // leak the user's GitHub token to an attacker-controlled host).
      return GITHUB_DOMAINS.some(
        (d) => hostname === d || hostname.endsWith("." + d),
      );
    } catch {
      return false;
    }
  },

  async buildGithubAuthHeaders(): Promise<Record<string, string> | null> {
    const conn = await getConnectionWithSecrets("github");
    if (!conn?.secrets.token) return null;
    return { Authorization: `token ${conn.secrets.token}` };
  },

  /**
   * Fetch a remote image with SSRF protection. Validates the target host
   * against private/loopback/link-local ranges on EVERY hop (including
   * redirects), and never forwards auth headers past the first hop. Pass
   * `authHeaders` for the GitHub path, or `null` for an unauthenticated
   * passthrough. Throws `SsrfBlockedError` if any hop resolves to a blocked
   * address.
   */
  async safeImageFetch(
    initialUrl: string,
    authHeaders: Record<string, string> | null,
  ): Promise<Response> {
    let url = initialUrl;
    let headers: Record<string, string> | undefined = authHeaders ?? undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertUrlAllowed(url);
      // Manual redirect: undici (Node's global fetch) exposes the Location
      // header — unlike a browser's opaqueredirect — so we re-validate each
      // hop instead of letting the network stack follow redirects blindly
      // into a private address.
      const response = await fetch(url, { headers, redirect: "manual" });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return onlyImages(response);
        url = new URL(location, url).toString();
        headers = undefined; // drop auth before following a redirect
        continue;
      }
      return onlyImages(response);
    }
    throw new SsrfBlockedError("too many redirects");
  },

  /**
   * Proxy a remote http(s) image — GitHub-authenticated when applicable, else an
   * SSRF-guarded passthrough — returning a `Response`. Shared by the web HTTP
   * image endpoint (`/__img`) so browsers can load remote images the same way the
   * Electron `mains-img://` protocol does. Throws `SsrfBlockedError` for blocked
   * targets.
   */
  async proxyImage(originalUrl: string): Promise<Response> {
    let parsed: URL;
    try {
      parsed = new URL(originalUrl);
    } catch {
      return new Response("Invalid url", { status: 400 });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return new Response("Only HTTP(S) URLs are supported", { status: 400 });
    }
    const headers = this.matchUrlToGithub(originalUrl)
      ? await this.buildGithubAuthHeaders()
      : null;
    const response = await this.safeImageFetch(originalUrl, headers);
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  },
};
