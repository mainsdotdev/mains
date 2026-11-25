import * as fs from "fs";
import * as path from "path";
import { Readable } from "node:stream";
import { verifySignedPath } from "./imageProxy.signing";
import { isLocalImagePreviewSize } from "@mains/contracts/image-preview";
import { DOCUMENT_PREVIEW_MAX_BYTES, OUTPUT_FILE_MAX_BYTES, outputMediaMimeType } from "@mains/contracts/output-files";
import { MAX_PREVIEW_SOURCE_BYTES, readImagePreview, UnsupportedImagePreviewError } from "./image-previews";

// Serving signed local files (`mains-localimg://` / `mains-localdoc://` in
// Electron; `GET /__localimg` / `/__localdoc` in web mode). Electron-free so the
// headless WS host (`mains serve`) can reuse the exact same logic: parse the
// signed query, verify the HMAC + TTL, then read the file under symlink/size/
// mime guards. The HMAC signature is the authorization — there is no path
// allowlist. See imageProxy.signing.ts.

export const MAX_IMAGE_SIZE = 32 * 1024 * 1024; // Codex image generation can return a 32 MB image.
export const MAX_DOCUMENT_SIZE = DOCUMENT_PREVIEW_MAX_BYTES;

const LOCALIMG_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

const LOCALDOC_EXT_MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
};

export async function serveLocalImage(requestUrl: URL): Promise<Response> {
  const rawPath = requestUrl.searchParams.get("path");
  const rawExp = requestUrl.searchParams.get("exp");
  const rawSig = requestUrl.searchParams.get("sig");
  const rawSize = requestUrl.searchParams.get("size");
  const maxSide = rawSize === null ? undefined : Number(rawSize);
  if (maxSide !== undefined && !isLocalImagePreviewSize(maxSide)) return new Response("Invalid preview size", { status: 400 });

  const verified = verifySignedPath(rawPath, rawExp, rawSig, maxSide);
  if (!verified.ok) {
    return new Response(`Forbidden (${verified.reason})`, { status: 403 });
  }

  const resolved = path.resolve(verified.path);
  if (resolved.includes("\0")) return new Response("Invalid path", { status: 400 });

  const ext = path.extname(resolved).toLowerCase();
  const mime = LOCALIMG_EXT_MIME[ext];
  if (!mime) return new Response("Unsupported file type", { status: 400 });

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (stat.isSymbolicLink()) {
    return new Response("Symlinks not allowed", { status: 403 });
  }
  if (!stat.isFile()) {
    return new Response("Not a file", { status: 404 });
  }
  if (stat.size > (maxSide ? MAX_PREVIEW_SOURCE_BYTES : MAX_IMAGE_SIZE)) {
    return new Response("Image too large", { status: 413 });
  }

  // SVGs are already resolution-independent. Other local image previews share
  // the attachment codec/cache, and are generated only when the <img> loads.
  if (maxSide && ext !== ".svg") {
    try {
      const preview = await readImagePreview(resolved, maxSide, { preserveAlpha: true });
      return new Response(new Uint8Array(preview.bytes), {
        headers: { "Content-Type": preview.mime, "Cache-Control": "private, max-age=60" },
      });
    } catch (error) {
      // Keep formats unsupported by a host codec displayable, within the
      // existing original-file limit (e.g. animated GIFs on Electron).
      if (!(error instanceof UnsupportedImagePreviewError)) throw error;
    }
  }
  if (stat.size > MAX_IMAGE_SIZE) return new Response("Image too large", { status: 413 });
  const data = fs.readFileSync(resolved);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function serveLocalDocument(requestUrl: URL, range: string | null = null): Promise<Response> {
  const rawPath = requestUrl.searchParams.get("path");
  const rawExp = requestUrl.searchParams.get("exp");
  const rawSig = requestUrl.searchParams.get("sig");

  const verified = verifySignedPath(rawPath, rawExp, rawSig);
  if (!verified.ok) {
    return new Response(`Forbidden (${verified.reason})`, { status: 403 });
  }

  const resolved = path.resolve(verified.path);
  if (resolved.includes("\0")) return new Response("Invalid path", { status: 400 });

  const ext = path.extname(resolved).toLowerCase();
  const mediaMime = outputMediaMimeType(ext.slice(1));
  const mime = LOCALDOC_EXT_MIME[ext] ?? mediaMime;
  if (!mime) return new Response("Unsupported file type", { status: 400 });

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (stat.isSymbolicLink()) {
    return new Response("Symlinks not allowed", { status: 403 });
  }
  if (!stat.isFile()) {
    return new Response("Not a file", { status: 404 });
  }
  if (mediaMime) return serveLocalMedia(resolved, mediaMime, stat, range);
  if (stat.size > MAX_DOCUMENT_SIZE) {
    return new Response("Document too large", { status: 413 });
  }

  const data = fs.readFileSync(resolved);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=60",
      // The renderer pulls these bytes via fetch() (cross-origin to the
      // mains-localdoc scheme), so it needs an explicit CORS allow.
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function serveLocalMedia(file: string, mime: string, stat: fs.Stats, range: string | null): Promise<Response> {
  const { size } = stat;
  if (size > OUTPUT_FILE_MAX_BYTES) return new Response("Media file too large", { status: 413 });
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "private, no-store",
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
  });
  let start = 0;
  let end = size - 1;
  const span = range?.match(/^bytes=(?=\d|-\d)(\d*)-(\d*)$/i);
  if (span) {
    if (span[1]) {
      start = Number(span[1]);
      if (span[2]) end = Math.min(end, Number(span[2]));
    } else {
      start = Math.max(0, size - Number(span[2]));
    }
    if (start > end) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  if (size === 0) return new Response(null, { headers });
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK).catch(() => null);
  if (!handle) return new Response("Media file unavailable", { status: 404 });
  try {
    const opened = await handle.stat();
    if (opened.isFile() && opened.dev === stat.dev && opened.ino === stat.ino && opened.size === size && opened.mtimeMs === stat.mtimeMs) {
      const body = Readable.toWeb(handle.createReadStream({ start, end }), { strategy: { highWaterMark: 1 } });
      // Node and DOM declarations differ on BYOB readers, but share this stream at runtime.
      return new Response(body as unknown as ReadableStream<Uint8Array>, { status: span ? 206 : 200, headers });
    }
  } catch {
    // The file may have been removed or replaced between lookup and open.
  }
  await handle.close();
  return new Response("Media file unavailable", { status: 404 });
}
