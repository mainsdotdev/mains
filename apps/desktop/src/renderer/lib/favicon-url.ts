/**
 * Conservative favicon fallback for a page URL.
 *
 * Only the origin survives: paths, queries, fragments, and credentials from
 * agent-authored URLs must not be copied into an automatic image request.
 */
export function faviconUrlForHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}/favicon.ico`;
  } catch {
    return null;
  }
}
