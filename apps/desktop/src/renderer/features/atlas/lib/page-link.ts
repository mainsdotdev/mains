function pageIdFromRoute(route: string): string | null {
  const match = route.match(/^\/atlas\/([^/?#]+)\/?(?:[?#].*)?$/);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return /^[\w-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Recognize app Page references, including links in older agent responses. */
export function atlasPageIdFromHref(href: string, appHref: string): string | null {
  if (href.startsWith("/atlas/")) return pageIdFromRoute(href);
  if (href.startsWith("#/atlas/")) return pageIdFromRoute(href.slice(1));
  try {
    const url = new URL(href);
    const app = new URL(appHref);
    const web = url.protocol === "http:" || url.protocol === "https:";
    if ((!web && url.protocol !== "file:") || url.username || url.password) return null;
    const sameOrigin = url.origin === app.origin && url.protocol === app.protocol;
    const sameEntry = sameOrigin && url.pathname === app.pathname;
    // Dev-server links were previously guessed by agents and saved in transcripts.
    const legacyEntry = web && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && (url.pathname === "/" || url.pathname === "/index.html");
    if ((sameEntry || legacyEntry) && url.hash.startsWith("#/atlas/")) {
      return pageIdFromRoute(url.hash.slice(1));
    }
    return web && sameOrigin ? pageIdFromRoute(url.pathname) : null;
  } catch {
    return null;
  }
}
