/**
 * Conservative favicon fallback for a page URL.
 *
 * Only the origin survives: paths, queries, fragments, and credentials from
 * agent-authored URLs must not be copied into an automatic image request.
 * Figma's root favicon currently serves a different brand's icon, so use the
 * icon declared by Figma's own pages for its known hosts.
 */
export function faviconUrlForHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname === "figma.com" || url.hostname === "www.figma.com") {
      return "https://static.figma.com/app/icon/2/favicon.png";
    }
    return `${url.origin}/favicon.ico`;
  } catch {
    return null;
  }
}
