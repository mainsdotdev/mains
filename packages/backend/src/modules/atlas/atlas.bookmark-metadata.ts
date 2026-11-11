import { parse, type DefaultTreeAdapterMap } from "parse5";
import { assertPublicHttpUrl } from "../imageProxy";

/** Keep meaningful queries and fragment routes; remove only known tracking keys. */
export function bookmarkUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("Enter a valid bookmark URL");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a full http or https URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Bookmarks require an http or https URL without credentials");
  const original = url.href;
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key)) url.searchParams.delete(key);
  return { url: original, normalizedUrl: url.href };
}

/** Bounded, unauthenticated fetching. Every redirect is checked before fetching. */
export async function fetchBookmarkResource(initial: string, image = false, owner?: AbortSignal) {
  const timeout = AbortSignal.timeout(12000);
  const signal = owner ? AbortSignal.any([owner, timeout]) : timeout;
  let url = initial;
  const limit = image ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted();
    await assertPublicHttpUrl(url);
    signal.throwIfAborted();
    const response = await fetch(url, { signal, redirect: "manual", credentials: "omit",
      headers: { Accept: image ? "image/*" : "text/html,application/xhtml+xml", "User-Agent": "MainsBookmark/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) throw new Error("The page redirected without a destination");
      url = bookmarkUrl(new URL(next, url).href).url;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`The page returned HTTP ${response.status}`); }
    const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (image ? !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime) : !["text/html", "application/xhtml+xml"].includes(mime)) {
      await response.body?.cancel();
      throw new Error(image ? "No supported preview image" : "This URL does not return an HTML page");
    }
    if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("Page or image exceeds the download limit"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The page returned no content");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error("Page or image exceeds the download limit");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { url, mime, bytes: Buffer.concat(chunks) };
  }
  throw new Error("The page redirected too many times");
}

type Node = DefaultTreeAdapterMap["node"];
const clean = (value: string, length: number) => value.replace(/\s+/g, " ").trim().slice(0, length);
export function extractBookmarkMetadata(html: string, url: string) {
  const meta = new Map<string, string>(), words: string[] = [];
  let pageTitle = "", favicon = "", base = url, textLength = 0;
  function walk(node: Node, inHead = false) {
    if ("tagName" in node) {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name.toLowerCase(), value]));
      if (["script", "style", "noscript", "svg", "nav", "footer", "header"].includes(node.tagName)) return;
      if (node.tagName === "meta") {
        const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
        if (!meta.has(key) && attrs.content) meta.set(key, clean(attrs.content, 4096));
      }
      if (node.tagName === "base" && attrs.href) {
        try { base = new URL(attrs.href, url).href; } catch { /* Use the response URL. */ }
      }
      if (node.tagName === "link" && /(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(attrs.rel ?? "") && !favicon) favicon = attrs.href ?? "";
      if (node.tagName === "title") pageTitle = node.childNodes.filter((child) => child.nodeName === "#text")
        .map((child) => "value" in child ? child.value : "").join("");
      inHead ||= node.tagName === "head";
    }
    if (node.nodeName === "#text" && "value" in node && !inHead && textLength < 12000) {
      const word = clean(node.value, 12000 - textLength);
      if (word) { words.push(word); textLength += word.length + 1; }
    }
    if ("childNodes" in node) for (const child of node.childNodes) walk(child, inHead);
  }
  walk(parse(html));
  const absolute = (value: string | undefined) => {
    if (!value) return undefined;
    try { return bookmarkUrl(new URL(value, base).href).url; } catch { return undefined; }
  };
  return {
    title: clean(meta.get("og:title") ?? meta.get("twitter:title") ?? pageTitle, 240),
    description: clean(meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description") ?? "", 2000),
    siteName: clean(meta.get("og:site_name") ?? new URL(url).hostname, 240),
    imageUrl: absolute(meta.get("og:image") ?? meta.get("twitter:image")),
    faviconUrl: absolute(favicon || "/favicon.ico"),
    contentType: clean(meta.get("og:type") ?? "website", 64),
    text: clean(words.join(" "), 12000),
  };
}
