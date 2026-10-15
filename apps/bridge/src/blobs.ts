import { SignJWT, jwtVerify } from "jose";
import { BRIDGE_BLOB_CIPHER_OVERHEAD, bridgeBlobChunkCount, bridgeBlobChunkSize, validateBridgeBlobIdentity,
  type BridgeBlobPresignRequest, type BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { authenticate, identityIsActive, type DevAuthEnv } from "./auth";
import { bridgeAccountPrefix, type BlobReservation } from "./quota";
import type { BridgeIdentity } from "./auth";

export interface BlobEnv extends DevAuthEnv { BLOBS: R2Bucket }
const audience = "mains-bridge-blob";
const signingKey = (env: BlobEnv) => new TextEncoder().encode(`mains.bridge.v1/blob-url:${env.BETTER_AUTH_SECRET ?? env.BRIDGE_DEV_SECRET}`);
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
export async function handleBlobs(request: Request, env: BlobEnv, quota: {
  reserve(identity: BridgeIdentity, entries: BlobReservation[], expires: number): Promise<{ status: number; error: string | null }>;
  put(identity: BridgeIdentity, key: string, expires: number, bytes: Uint8Array): Promise<{ status: number; error: string | null }>;
}): Promise<Response> {
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
    const prefix = await bridgeAccountPrefix(identity.accountId);
    const expires = Math.min(Math.floor(identity.expiresAt / 1000), Math.floor(Date.now() / 1000) + 600);
    if (input.op === "put") {
      const entries = input.blobs.flatMap((blob) => Array.from({ length: bridgeBlobChunkCount(blob.size) }, (_, index) =>
        ({ key: `${prefix}${blob.blobId}/${index}`, bytes: bridgeBlobChunkSize(blob.size, index) + BRIDGE_BLOB_CIPHER_OVERHEAD })));
      const result = await quota.reserve(identity, entries, expires * 1000);
      if (result.error) return Response.json({ error: result.error }, { status: result.status });
    }
    const blobs: BridgeBlobPresignResult["blobs"] = [];
    for (const blob of input.blobs) {
      const chunks = [];
      for (let index = 0; index < bridgeBlobChunkCount(blob.size); index++) {
        const key = `${prefix}${blob.blobId}/${index}`;
        const token = await new SignJWT({ key, blobId: blob.blobId, size: blob.size, index, op: input.op,
          identity: { accountId: identity.accountId, backendId: identity.backendId, expiresAt: identity.expiresAt, ...(identity.credentialHash ? { credentialHash: identity.credentialHash } : {}) } })
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
  if ((!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) && (env.BRIDGE_DEV_AUTH !== "true" || !env.BRIDGE_DEV_SECRET || env.BRIDGE_DEV_SECRET.length < 32)) return new Response("Unauthorized", { status: 401 });
  try {
    const { payload } = await jwtVerify(url.searchParams.get("cap") ?? "", signingKey(env), { algorithms: ["HS256"], issuer: audience, audience, maxTokenAge: "10m", requiredClaims: ["exp", "iat"] });
    validateBridgeBlobIdentity(payload);
    const identity = payload.identity as import("./auth").BridgeIdentity | undefined;
    if (!identity || !await identityIsActive(identity, env)) return new Response("Backend access revoked", { status: 403 });
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
    const result = await quota.put(identity, payload.key, Number(payload.exp) * 1000, bytes);
    return result.error ? Response.json({ error: result.error }, { status: result.status }) : new Response(null, { status: 204 });
  } catch { return new Response("Invalid blob capability or payload", { status: 403 }); }
}
