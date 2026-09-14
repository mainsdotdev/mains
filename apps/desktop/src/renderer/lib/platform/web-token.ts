const STORAGE_KEY = "mains.token";

let resolved = false;
let cached: string | undefined;

/**
 * The pairing token a web client (the renderer served by the backend over
 * HTTP) presents. It arrives once as a `?token=` query param and is kept in
 * localStorage so a reload still connects. Read by the WS handshake and by URLs
 * the browser loads on its own — an `<img src="/__img?…">` can't send a
 * subprotocol, so the image proxy takes it as a query param too.
 */
export function webToken(): string | undefined {
  if (resolved) return cached;
  if (typeof window === "undefined") return undefined;

  let token = new URLSearchParams(window.location.search).get("token") ?? undefined;
  if (token) {
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* ignore */
    }
  } else {
    try {
      token = localStorage.getItem(STORAGE_KEY) ?? undefined;
    } catch {
      /* ignore */
    }
  }
  resolved = true;
  cached = token;
  return token;
}
