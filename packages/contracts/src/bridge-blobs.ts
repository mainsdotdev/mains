/** Shared bounds; neither the hub nor R2 receives filenames or plaintext hashes. */
export const BRIDGE_BLOB_CHUNK_BYTES = 4 * 1024 * 1024;
export const BRIDGE_BLOB_MAX_BYTES = 50 * 1024 * 1024;
export const BRIDGE_BLOB_CIPHER_OVERHEAD = 24 + 16;
export interface BridgeBlobIdentity { blobId: string; size: number }
/** This manifest only travels inside an authenticated, encrypted record body. */
export interface BridgeBlobRef extends BridgeBlobIdentity {
  /** Schema 4: a JSON-encoded database string, restored before applying its row. */
  kind?: "value";
  column: string;
  name: string;
  mime: string | null;
  /** For matching an already selected output, never a path to read on a replica. */
  sourcePath?: string;
}
export interface BridgeBlobPresignRequest { blobs: BridgeBlobIdentity[]; op: "put" | "get" }
export interface BridgeBlobChunkUrl { index: number; url: string; exists: boolean }
export interface BridgeBlobPresignResult { blobs: Array<BridgeBlobIdentity & { chunks: BridgeBlobChunkUrl[] }> }
export function validateBridgeBlobIdentity(value: unknown): asserts value is BridgeBlobIdentity {
  const ref = value as BridgeBlobIdentity | null;
  if (!ref || typeof ref.blobId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ref.blobId) ||
      !Number.isSafeInteger(ref.size) || ref.size < 0 || ref.size > BRIDGE_BLOB_MAX_BYTES)
    throw new Error("Invalid Bridge blob identity");
}
export function bridgeBlobChunkCount(size: number): number { return Math.max(1, Math.ceil(size / BRIDGE_BLOB_CHUNK_BYTES)); }
export function bridgeBlobChunkSize(size: number, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= bridgeBlobChunkCount(size)) throw new Error("Invalid Bridge chunk index");
  return Math.min(BRIDGE_BLOB_CHUNK_BYTES, size - index * BRIDGE_BLOB_CHUNK_BYTES);
}
