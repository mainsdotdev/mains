import { BRIDGE_BLOB_CHUNK_BYTES, BRIDGE_BLOB_CIPHER_OVERHEAD } from "@mains/contracts/bridge-blobs";

/** A PITR bookmark is useful only while its ciphertext still exists. Archive
 * immutable chunks before GC removes their live copy; never charge archives to
 * the user's active quota. The independent bucket has its own retention policy. */
export async function archiveBlobChunks(source: R2Bucket, archive: R2Bucket | undefined, keys: string[]): Promise<void> {
  if (!archive) return; // Local fixtures and older deployments remain compatible.
  for (const key of keys) {
    const object = await source.get(key);
    if (!object) continue; // Retry after an already committed physical deletion.
    const archiveKey = `deleted/${new Date().toISOString().slice(0, 10)}/${key}/${object.etag}`;
    const existing = await archive.head(archiveKey);
    if (existing) {
      await object.body.cancel();
      if (existing.size !== object.size || existing.customMetadata?.sourceEtag !== object.etag) throw new Error("Bridge archive receipt does not match");
      continue;
    }
    // A stream piped between two R2 bindings while the DO input gate is held can
    // wait on that same gate. Buffer one bounded encrypted chunk before PUT.
    if (object.size > BRIDGE_BLOB_CHUNK_BYTES + BRIDGE_BLOB_CIPHER_OVERHEAD) { await object.body.cancel(); throw new Error("Invalid archived chunk size"); }
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength !== object.size) throw new Error("Incomplete archived chunk");
    const copy = await archive.put(archiveKey, bytes, {
      onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { sourceKey: key, sourceEtag: object.etag },
    });
    if (!copy || copy.size !== object.size) throw new Error("Bridge ciphertext archive was not committed");
  }
}
