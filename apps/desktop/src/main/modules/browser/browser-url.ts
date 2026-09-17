const BLANK_URL = "about:blank";
const DEFAULT_SEARCH_URL = "https://www.google.com/search?q=";

export const BROWSER_ALLOWED_PROTOCOLS = new Set(["http:", "https:", "about:"]);
export { BLANK_URL };

function looksLikeLocalhost(value: string): boolean {
  return /^(?:localhost|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(value);
}

function looksLikeIpv4(value: string): boolean {
  const host = value.split(/[/:]/, 1)[0];
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function looksLikeDomain(value: string): boolean {
  const host = value.split(/[/:]/, 1)[0];
  return (
    host.includes(".") &&
    !host.startsWith(".") &&
    !host.endsWith(".") &&
    !/\s/.test(value)
  );
}

export function isAllowedBrowserUrl(value: string): boolean {
  try {
    return BROWSER_ALLOWED_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Resolve omnibox input to a safe browser URL. Explicit but unsupported schemes
 * are refused; ordinary text becomes a search instead of silently navigating to
 * about:blank.
 */
export function resolveBrowserInput(raw: string): string {
  const value = (raw || "").trim();
  if (!value) return BLANK_URL;

  if (/^about:/i.test(value)) {
    return isAllowedBrowserUrl(value) ? value : BLANK_URL;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return isAllowedBrowserUrl(value) ? value : BLANK_URL;
  }

  if (looksLikeLocalhost(value) || looksLikeIpv4(value)) {
    return `http://${value}`;
  }

  if (looksLikeDomain(value)) {
    const candidate = `https://${value}`;
    return isAllowedBrowserUrl(candidate) ? candidate : BLANK_URL;
  }

  return `${DEFAULT_SEARCH_URL}${encodeURIComponent(value)}`;
}

