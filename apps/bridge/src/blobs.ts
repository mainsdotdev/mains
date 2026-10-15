import { SignJWT, jwtVerify } from "jose";
import { BRIDGE_BLOB_CIPHER_OVERHEAD, bridgeBlobChunkCount, bridgeBlobChunkSize, validateBridgeBlobIdentity,
  type BridgeBlobPresignRequest, type BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { authenticate, type DevAuthEnv } from "./auth";

export interface BlobEnv extends DevAuthEnv { BLOBS: R2Bucket }
const audience = "mains-bridge-blob";
const signingKey = (env: BlobEnv) => new TextEncoder().encode(`mains.bridge.v1/blob-url:${env.BRIDGE_DEV_SECRET}`);
async function boundedBytes(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > limit) throw new Error("Payload too large");
  const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("Payload too large"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Short-lived Worker capabilities stream ciphertext to a private R2 binding.
 * These are Worker-signed URLs, not S3 SigV4 URLs; no S3 credential is needed locally. */
export async function handleBlobs(request: Request, env: BlobEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/v1/blobs/presign" && request.method === "POST") {
    const identity = await authenticate(request, env);
    if (!identity) return new Response("Unauthorized", { status: 401 });
    let input: BridgeBlobPresignRequest;
    try {
      input = JSON.parse(new TextDecoder().decode(await boundedBytes(request, 16 * 1024)));
      if (!input || !["get", "put"].includes(input.op) || !Array.isArray(input.blobs) || !input.blobs.length || input.blobs.length > 16) throw new Error("Invalid request");
      for (const blob of input.blobs) validateBridgeBlobIdentity(blob);
    } catch { return new Response("Invalid blob request", { status: 400 }); }
    const account = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity.accountId)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const expires = Math.min(Math.floor(identity.expiresAt / 1000), Math.floor(Date.now() / 1000) + 600);
    const blobs: BridgeBlobPresignResult["blobs"] = [];
    for (const blob of input.blobs) {
      const chunks = [];
      for (let index = 0; index < bridgeBlobChunkCount(blob.size); index++) {
        const key = `${account}/${blob.blobId}/${index}`;
        const token = await new SignJWT({ key, blobId: blob.blobId, size: blob.size, index, op: input.op })
          .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setAudience(audience).setIssuer(audience)
          .setIssuedAt().setExpirationTime(expires).sign(signingKey(env));
        const signed = new URL("/v1/blobs/chunk", url); signed.searchParams.set("cap", token);
        chunks.push({ index, url: signed.toString(), exists: !!await env.BLOBS.head(key) });
      }
      blobs.push({ blobId: blob.blobId, size: blob.size, chunks });
    }
    return Response.json({ blobs } satisfies BridgeBlobPresignResult, { headers: { "Cache-Control": "no-store" } });
  }
  if (url.pathname !== "/v1/blobs/chunk" || !["GET", "PUT"].includes(request.method)) return new Response("Not found", { status: 404 });
  if (env.BRIDGE_DEV_AUTH !== "true" || !env.BRIDGE_DEV_SECRET || env.BRIDGE_DEV_SECRET.length < 32) return new Response("Unauthorized", { status: 401 });
  try {
    const { payload } = await jwtVerify(url.searchParams.get("cap") ?? "", signingKey(env), { algorithms: ["HS256"], issuer: audience, audience, maxTokenAge: "10m", requiredClaims: ["exp", "iat"] });
    validateBridgeBlobIdentity(payload);
    const index = payload.index as number;
    const size = bridgeBlobChunkSize(payload.size as number, index) + BRIDGE_BLOB_CIPHER_OVERHEAD;
    if (typeof payload.key !== "string" || !/^[a-f0-9]{64}\/[A-Za-z0-9_-]{43}\/\d+$/.test(payload.key) || payload.op !== request.method.toLowerCase())
      return new Response("Forbidden", { status: 403 });
    if (request.method === "GET") {
      const object = await env.BLOBS.get(payload.key);
      if (!object) return new Response("Blob not found", { status: 404 });
      return new Response(object.body, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(object.size), "Cache-Control": "private, no-store" } });
    }
    const bytes = await boundedBytes(request, size);
    if (bytes.byteLength !== size) return new Response("Invalid chunk length", { status: 400 });
    // Immutable account-scoped chunks. Repeated PUTs cannot replace previously sealed bytes.
    await env.BLOBS.put(payload.key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/octet-stream" } });
    return new Response(null, { status: 204 });
  } catch { return new Response("Invalid blob capability or payload", { status: 403 }); }
}
