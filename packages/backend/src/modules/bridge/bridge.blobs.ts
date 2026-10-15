import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { BRIDGE_BLOB_CHUNK_BYTES, BRIDGE_BLOB_CIPHER_OVERHEAD, BRIDGE_BLOB_MAX_BYTES, bridgeBlobChunkCount, bridgeBlobChunkSize,
  validateBridgeBlobIdentity, type BridgeBlobRef, type BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { createBridgeBlobCrypto } from "./bridge.blob-crypto";

export interface BridgeBlobsOptions {
  accountKey: Uint8Array; dataDir: string; url: string; token: string | (() => Promise<string>);
  cacheLimitBytes?: number;
}
const safeExtension = (name: string) => /^\.[a-z0-9]{1,12}$/i.test(extname(name)) ? extname(name).toLowerCase() : ".bin";

/** Immutable files, bounded transfers and verified lazy cache, shared by Electron and Node. */
export function createBridgeBlobs(options: BridgeBlobsOptions) {
  const crypto = createBridgeBlobCrypto(options.accountKey);
  const root = join(options.dataDir, "bridge", "blobs");
  const uploads = join(options.dataDir, "bridge", "uploads");
  const origin = new URL(options.url.replace(/^ws/, "http"));
  const jobs = new Map<string, Promise<string>>(), pinned = new Set<string>();
  const opened = new Map<string, BridgeBlobRef>();
  const activeDownloads = new Set<string>(), waiting: Array<() => void> = [];
  let downloadSlots = 2;
  const abort = new AbortController();
  let stopped = false;
  async function directory() {
    for (const dir of [join(options.dataDir, "bridge"), root]) {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe Bridge cache directory");
    }
  }
  const cachePath = (ref: BridgeBlobRef) => join(root, ref.blobId + safeExtension(ref.name));
  function verify(ref: BridgeBlobRef, bytes: Uint8Array) {
    if (bytes.length !== ref.size || crypto.id(bytes) !== ref.blobId) throw new Error("Bridge blob integrity check failed");
  }
  async function cached(ref: BridgeBlobRef): Promise<string | undefined> {
    const target = cachePath(ref);
    try {
      const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== ref.size || stat.size > BRIDGE_BLOB_MAX_BYTES) throw new Error("Invalid cached blob");
        verify(ref, await handle.readFile());
      } finally { await handle.close(); }
      await fs.utimes(target, new Date(), new Date());
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") await fs.unlink(target).catch(() => {});
      return undefined;
    }
  }
  async function trim(keep: string) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory() && /^\.parts-[A-Za-z0-9_-]{43}$/.test(entry.name)) {
        const directory = join(root, entry.name), stat = await fs.lstat(directory);
        if (stat.isSymbolicLink()) continue;
        let size = 0;
        for (const part of await fs.readdir(directory, { withFileTypes: true })) if (part.isFile()) size += (await fs.lstat(join(directory, part.name))).size;
        files.push({ path: directory, size, time: stat.mtimeMs, partial: true }); continue;
      }
      if (!entry.isFile() || !/^[A-Za-z0-9_-]{43}\.[a-z0-9]{1,12}$/.test(entry.name)) continue;
      const path = join(root, entry.name), stat = await fs.lstat(path);
      if (!stat.isSymbolicLink()) files.push({ path, size: stat.size, time: stat.mtimeMs, partial: false });
    }
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.time - b.time)) {
      if (total <= (options.cacheLimitBytes ?? 256 * 1024 * 1024)) break;
      if (file.path === keep || pinned.has(file.path) || file.partial && activeDownloads.has(basename(file.path).slice(7))) continue;
      await fs.rm(file.path, { recursive: file.partial, force: true }).catch(() => {}); total -= file.size;
    }
  }
  async function save(ref: BridgeBlobRef, bytes: Uint8Array): Promise<string> {
    verify(ref, bytes); await directory();
    const existing = await cached(ref); if (existing) return existing;
    const target = cachePath(ref), temp = join(root, `.pending-${randomUUID()}`);
    try {
      await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
      await fs.chmod(temp, 0o444); await fs.rename(temp, target);
      await trim(target); return target;
    } finally { await fs.unlink(temp).catch(() => {}); }
  }
  async function request(url: string, init: RequestInit = {}) {
    if (stopped) throw new Error("Bridge blob transfer is stopped");
    return fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) });
  }
  async function readBounded(response: Response, expected: number): Promise<Uint8Array> {
    const reader = response.body?.getReader(); if (!reader) throw new Error("Missing Bridge chunk body");
    const bytes = new Uint8Array(expected); let offset = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        if (offset + chunk.value.length > expected) { await reader.cancel(); throw new Error("Invalid Bridge chunk length"); }
        bytes.set(chunk.value, offset); offset += chunk.value.length;
      }
    } finally { reader.releaseLock(); }
    if (offset !== expected) throw new Error("Invalid Bridge chunk length");
    return bytes;
  }
  async function urls(ref: BridgeBlobRef, op: "get" | "put") {
    const token = typeof options.token === "function" ? await options.token() : options.token;
    const response = await request(new URL("/v1/blobs/presign", origin).toString(), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op, blobs: [{ blobId: ref.blobId, size: ref.size }] }) });
    if (!response.ok) throw new Error(response.status === 413 ? "Bridge storage quota exceeded; local files remain queued" :
      response.status === 429 ? "Bridge write rate limit reached; local files remain queued" : `Bridge blob authorization failed (${response.status})`);
    const body = await response.json() as BridgeBlobPresignResult;
    const blob = body.blobs?.[0];
    if (body.blobs?.length !== 1 || blob?.blobId !== ref.blobId || blob.size !== ref.size || !Array.isArray(blob.chunks) || blob.chunks.length !== bridgeBlobChunkCount(ref.size))
      throw new Error("Invalid Bridge blob URL response");
    for (const [index, chunk] of blob.chunks.entries()) {
      const url = new URL(chunk.url);
      if (chunk.index !== index || typeof chunk.exists !== "boolean" || url.origin !== origin.origin || url.pathname !== "/v1/blobs/chunk" || url.username || url.password)
        throw new Error("Invalid Bridge blob chunk URL");
    }
    return blob.chunks;
  }
  async function download(ref: BridgeBlobRef): Promise<string> {
    await directory();
    const existing = await cached(ref); if (existing) return existing;
    const chunks = await urls(ref, "get"), bytes = new Uint8Array(ref.size);
    // Persist authenticated ciphertext chunks so an interrupted download resumes after restart.
    const partial = join(root, `.parts-${ref.blobId}`);
    await fs.mkdir(partial, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(partial)).isSymbolicLink()) throw new Error("Unsafe Bridge partial directory");
    for (const chunk of chunks) {
      const partPath = join(partial, String(chunk.index));
      let sealed: Uint8Array | undefined;
      try {
        const handle = await fs.open(partPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { if ((await handle.stat()).size === bridgeBlobChunkSize(ref.size, chunk.index) + BRIDGE_BLOB_CIPHER_OVERHEAD) sealed = await handle.readFile(); }
        finally { await handle.close(); }
        if (sealed) crypto.open(ref, chunk.index, sealed); // Never trust an incomplete/tampered local part.
      } catch { sealed = undefined; }
      if (!sealed) {
        const response = await request(chunk.url);
        if (!response.ok) throw new Error(`Bridge file is unavailable (${response.status})`);
        sealed = await readBounded(response, bridgeBlobChunkSize(ref.size, chunk.index) + BRIDGE_BLOB_CIPHER_OVERHEAD);
        crypto.open(ref, chunk.index, sealed);
        const temp = join(partial, `.pending-${randomUUID()}`);
        try { await fs.writeFile(temp, sealed, { flag: "wx", mode: 0o600 }); await fs.rename(temp, partPath); }
        finally { await fs.unlink(temp).catch(() => {}); }
        await trim(partial);
      }
      bytes.set(crypto.open(ref, chunk.index, sealed), chunk.index * BRIDGE_BLOB_CHUNK_BYTES);
    }
    const path = await save(ref, bytes);
    await fs.rm(partial, { recursive: true, force: true });
    return path;
  }
  const api = {
    cached(ref: BridgeBlobRef): Promise<string | undefined> { validateBridgeBlobIdentity(ref); return cached(ref); },
    async isCachedFile(realPath: string): Promise<boolean> {
      const ref = opened.get(realPath); if (!ref) return false;
      try { await directory(); const file = await cached(ref); return !!file && await fs.realpath(file) === realPath; }
      catch { return false; }
    },
    async capture(bytes: Uint8Array, description: Pick<BridgeBlobRef, "column" | "name" | "mime" | "sourcePath">): Promise<BridgeBlobRef> {
      if (bytes.length > BRIDGE_BLOB_MAX_BYTES) throw new Error("Bridge file exceeds 50 MiB");
      const ref: BridgeBlobRef = { ...description, name: basename(description.name), blobId: crypto.id(bytes), size: bytes.length };
      await directory(); await fs.mkdir(uploads, { recursive: true, mode: 0o700 });
      if ((await fs.lstat(uploads)).isSymbolicLink()) throw new Error("Unsafe Bridge upload directory");
      const target = join(uploads, ref.blobId), temp = join(uploads, `.pending-${randomUUID()}`);
      try {
        const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { if ((await handle.stat()).size === ref.size) { verify(ref, await handle.readFile()); return ref; } }
        finally { await handle.close(); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      try { await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 }); await fs.chmod(temp, 0o444); await fs.rename(temp, target); }
      finally { await fs.unlink(temp).catch(() => {}); }
      return ref;
    },
    async publishCaptured(ref: BridgeBlobRef): Promise<void> {
      validateBridgeBlobIdentity(ref);
      const chunks = await urls(ref, "put");
      if (chunks.every((chunk) => chunk.exists)) return;
      await directory();
      if ((await fs.lstat(uploads)).isSymbolicLink()) throw new Error("Unsafe Bridge upload directory");
      const handle = await fs.open(join(uploads, ref.blobId), constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Uint8Array;
      try {
        if ((await handle.stat()).size !== ref.size) throw new Error("Bridge output snapshot is damaged");
        bytes = await handle.readFile(); verify(ref, bytes);
      } finally { await handle.close(); }
      await api.publish(bytes, ref);
      // Snapshots remain durable until their metadata is acknowledged. They are
      // separate from the disposable download LRU, including across restarts.
    },
    async releaseCaptured(refs: BridgeBlobRef[]): Promise<void> {
      try { if ((await fs.lstat(uploads)).isSymbolicLink()) return; } catch { return; }
      for (const ref of refs) { validateBridgeBlobIdentity(ref); await fs.unlink(join(uploads, ref.blobId)).catch(() => {}); }
    },
    async publish(bytes: Uint8Array, description: Pick<BridgeBlobRef, "column" | "name" | "mime" | "sourcePath">): Promise<BridgeBlobRef> {
      if (bytes.length > BRIDGE_BLOB_MAX_BYTES) throw new Error("Bridge file exceeds 50 MiB");
      const ref: BridgeBlobRef = { ...description, name: basename(description.name), blobId: crypto.id(bytes), size: bytes.length };
      const path = cachePath(ref); pinned.add(path);
      try {
        await save(ref, bytes);
        for (const chunk of await urls(ref, "put")) {
          if (chunk.exists) continue;
          const plaintext = bytes.subarray(chunk.index * BRIDGE_BLOB_CHUNK_BYTES, (chunk.index + 1) * BRIDGE_BLOB_CHUNK_BYTES);
          const response = await request(chunk.url, { method: "PUT", body: Buffer.from(crypto.seal(ref, chunk.index, plaintext)) });
          if (!response.ok) throw new Error(`Bridge blob upload failed (${response.status})`);
        }
        return ref;
      } finally { pinned.delete(path); }
    },
    resolve(ref: BridgeBlobRef): Promise<string> {
      validateBridgeBlobIdentity(ref);
      const key = `${ref.blobId}:${ref.size}:${safeExtension(ref.name)}`;
      const current = jobs.get(key); if (current) return current;
      const target = cachePath(ref); pinned.add(target);
      const job = (async () => {
        if (downloadSlots) downloadSlots--; else await new Promise<void>((resolve) => waiting.push(resolve));
        activeDownloads.add(ref.blobId);
        try { if (stopped) throw new Error("Bridge blob transfer is stopped"); return await download(ref); }
        finally { activeDownloads.delete(ref.blobId); const next = waiting.shift(); if (next) next(); else downloadSlots++; }
      })().then(async (file) => {
        opened.set(await fs.realpath(file), ref);
        if (opened.size > 512) opened.delete(opened.keys().next().value!);
        return file;
      }).finally(() => { jobs.delete(key); pinned.delete(target); });
      jobs.set(key, job); return job;
    },
    async stop() { stopped = true; abort.abort(); await Promise.allSettled(jobs.values()); opened.clear(); crypto.destroy(); },
  };
  return api;
}
export type BridgeBlobs = ReturnType<typeof createBridgeBlobs>;
