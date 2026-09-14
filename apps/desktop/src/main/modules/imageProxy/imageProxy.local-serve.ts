import * as fs from "fs";
import * as path from "path";
import { verifySignedPath } from "./imageProxy.signing";

// Serving signed local files (`mains-localimg://` / `mains-localdoc://` in
// Electron; `GET /__localimg` / `/__localdoc` in web mode). Electron-free so the
// headless WS host (`mains serve`) can reuse the exact same logic: parse the
// signed query, verify the HMAC + TTL, then read the file under symlink/size/
// mime guards. The HMAC signature is the authorization — there is no path
// allowlist. See imageProxy.signing.ts.

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024; // 25 MB

const LOCALIMG_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const LOCALDOC_EXT_MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function serveLocalImage(requestUrl: URL): Promise<Response> {
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
  if (stat.size > MAX_IMAGE_SIZE) {
    return new Response("Image too large", { status: 413 });
  }

  const data = fs.readFileSync(resolved);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function serveLocalDocument(requestUrl: URL): Promise<Response> {
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
  const mime = LOCALDOC_EXT_MIME[ext];
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
