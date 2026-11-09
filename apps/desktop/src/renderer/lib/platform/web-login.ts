import { runWebLoginExchange } from "../../../shared/remote-access-lifecycle";

const LEGACY_STORAGE_KEY = "mains.token";

/**
 * Take a single-use browser login code from the fragment, then scrub every old
 * browser owner-token location. The code is held only by the bootstrap call
 * stack until it is exchanged for HttpOnly cookies.
 */
export function takeWebLoginCode(): string | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* best effort migration from the former persistent owner-token flow */
  }

  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const changed =
    fragment.has("login") ||
    fragment.has("token") ||
    url.searchParams.has("token");
  const code = fragment.get("login") || undefined;
  if (!changed) return code;

  fragment.delete("login");
  fragment.delete("token");
  url.searchParams.delete("token");
  url.hash = fragment.toString();
  try {
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* the login code is still never persisted by application code */
  }
  return code;
}

/** Exchange a login code for HttpOnly WS and image-proxy cookies. */
export async function exchangeWebLogin(
  code: string | undefined,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<void> {
  if (!code) return;
  await runWebLoginExchange(async (exchangeSignal) => {
    const response = await fetchImpl("/__mains/web-session", {
      method: "POST",
      headers: { Authorization: `Bearer ${code}` },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: exchangeSignal,
    });
    if (!response.ok) {
      throw new Error(`Browser login failed (${response.status})`);
    }
  }, signal);
}
