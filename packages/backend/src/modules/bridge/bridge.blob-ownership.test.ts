import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { bridgeBlobChunkCount, BRIDGE_BLOB_CHUNK_BYTES } from "@mains/contracts/bridge-blobs";
import { createBridgeBlobs, type BridgeBlobs, type BridgeBlobsOptions } from "./bridge.blobs";
vi.mock("node:fs/promises", async (original) => {
  const filesystem = await original<typeof import("node:fs/promises")>();
  return { ...filesystem, writeFile: vi.fn(filesystem.writeFile) };
});

const clients: BridgeBlobs[] = [], directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stop();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});
async function client(options: Partial<Pick<BridgeBlobsOptions, "url" | "token" | "cacheLimitBytes">> = {}) {
  const dataDir = await fs.mkdtemp(join(tmpdir(), "mains-bridge-blob-owner-")); directories.push(dataDir);
  const blobs = createBridgeBlobs({ dataDir, url: "ws://127.0.0.1:1/v1/log", token: "test-only", accountKey: new Uint8Array(32).fill(37), ...options });
  clients.push(blobs); return { blobs, dataDir };
}
async function hub() {
  const chunks = new Map<string, Buffer>(), requests: Array<{ op: string; blobId: string; index: number }> = [];
  const failures = new Set<string>();
  const hooks: { chunk?: (request: typeof requests[number]) => Promise<void> } = {};
  let origin = "";
  const server = createServer((request, response) => { void (async () => {
    const target = new URL(request.url!, origin);
    if (target.pathname === "/v1/blobs/presign") {
      const body: Buffer[] = []; for await (const part of request) body.push(Buffer.from(part));
      const { blobs, op } = JSON.parse(Buffer.concat(body).toString());
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ blobs: blobs.map((ref: { blobId: string; size: number }) => ({ ...ref,
        chunks: Array.from({ length: bridgeBlobChunkCount(ref.size) }, (_, index) => ({ index,
          exists: chunks.has(`${ref.blobId}:${index}`), url: `${origin}/v1/blobs/chunk?blob=${ref.blobId}&index=${index}&op=${op}` })) })) }));
      return;
    }
    const blobId = target.searchParams.get("blob")!, index = Number(target.searchParams.get("index"));
    const op = request.method === "PUT" ? "put" : "get", key = `${blobId}:${index}`;
    const entry = { op, blobId, index }; requests.push(entry);
    if (op === "put") { const body: Buffer[] = []; for await (const part of request) body.push(Buffer.from(part)); chunks.set(key, Buffer.concat(body)); }
    await hooks.chunk?.(entry);
    if (op === "put") { response.writeHead(204); response.end(); }
    else if (failures.delete(key)) { response.writeHead(503); response.end(); }
    else { response.writeHead(chunks.has(key) ? 200 : 404); response.end(chunks.get(key)); }
  })().catch((error: Error) => response.destroy(error)); });
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture listener");
  origin = `http://127.0.0.1:${address.port}`;
  return { url: origin, chunks, requests, failures, hooks };
}
const description = { column: "metadata", name: "output.txt", mime: "text/plain" };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Bridge file transfer ownership", () => {
  it("keeps a publication's cache pin when an overlapping cache hit finishes", async () => {
    const remote = await hub(), a = await client({ ...remote, cacheLimitBytes: 8 });
    const bytes = Buffer.from("first"), ref = await a.blobs.publish(bytes, description);
    const path = await a.blobs.resolve(ref), entered = deferred(), gate = deferred();
    remote.chunks.delete(`${ref.blobId}:0`);
    remote.hooks.chunk = async (request) => {
      if (request.op === "put" && request.blobId === ref.blobId) { entered.resolve(); await gate.promise; }
    };
    const publishing = a.blobs.publish(bytes, description);
    await entered.promise;
    try {
      expect(await a.blobs.resolve(ref)).toBe(path);
      await a.blobs.publish(Buffer.from("second"), description);
      expect(await fs.readFile(path)).toEqual(bytes);
    } finally { gate.resolve(); await publishing; }
    await a.blobs.publish(Buffer.from("third"), description);
    await expect(fs.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds downloads to two and cancels both active and queued work on Stop", async () => {
    const remote = await hub(), a = await client(remote), b = await client(remote);
    const refs = await Promise.all(["first", "second", "third"].map((text) => a.blobs.publish(Buffer.from(text), description)));
    const gate = deferred();
    remote.hooks.chunk = async (request) => { if (request.op === "get") await gate.promise; };
    const resolving = Promise.allSettled(refs.map((ref) => b.blobs.resolve(ref)));
    try {
      await vi.waitFor(() => expect(remote.requests.filter(({ op }) => op === "get")).toHaveLength(2));
      const closing = b.blobs.stop();
      expect(b.blobs.stop()).toBe(closing);
      await closing;
      expect((await resolving).map((result) => result.status)).toEqual(["rejected", "rejected", "rejected"]);
      expect(remote.requests.filter(({ op }) => op === "get")).toHaveLength(2);
      await expect(b.blobs.resolve(refs[0])).rejects.toThrow("stopped");
    } finally { gate.resolve(); await resolving; }
  });

  it("freezes publication bytes, metadata and download identity at admission", async () => {
    const remote = await hub(), a = await client(remote), b = await client(remote);
    const bytes = Buffer.from("original"), metadata = { ...description };
    const publishing = a.blobs.publish(bytes, metadata);
    bytes.fill(120); metadata.name = "changed.bin";
    const ref = await publishing;
    expect(ref.name).toBe("output.txt");
    const resolving = b.blobs.resolve(ref);
    ref.blobId = "a".repeat(43); ref.name = "changed.pdf"; ref.size = 0;
    const file = await resolving;
    expect(file.endsWith(".txt")).toBe(true);
    expect(await fs.readFile(file)).toEqual(Buffer.from("original"));
  });

  it("drains a publication's disk write before destroying keys and aborts its network stage", async () => {
    const { blobs } = await client(), entered = deferred(), gate = deferred();
    const write = vi.mocked(fs.writeFile).getMockImplementation()!;
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      if (String(args[0]).includes("/bridge/blobs/.pending-")) { entered.resolve(); await gate.promise; }
      return write(...args);
    });
    const publishing = blobs.publish(Buffer.from("An admitted publication"), description);
    const refused = expect(publishing).rejects.toThrow(/stopped|abort/);
    await entered.promise;
    let closed = false;
    const closing = blobs.stop().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
    } finally { gate.resolve(); await refused; await closing; vi.mocked(fs.writeFile).mockImplementation(write); }
  });

  it("retires a publication waiting for credentials without waiting for the credential provider", async () => {
    let release!: (token: string) => void, closed = false;
    const token = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const { blobs } = await client({ token });
    const publishing = blobs.publish(Buffer.from("waiting for auth"), description);
    const refused = expect(publishing).rejects.toThrow(/stopped|abort/);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const closing = blobs.stop().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(true);
    } finally { release("late-token"); await refused; await closing; }
  });

  it("freezes captured bytes and metadata at admission", async () => {
    const { blobs, dataDir } = await client(), bytes = Buffer.from("original"), metadata = { ...description };
    const capturing = blobs.capture(bytes, metadata);
    bytes.fill(120); metadata.name = "changed.bin";
    const ref = await capturing;
    expect(ref.name).toBe("output.txt");
    expect(await fs.readFile(join(dataDir, "bridge", "uploads", ref.blobId))).toEqual(Buffer.from("original"));
  });

  it("coalesces content downloads while retaining each requested filename extension", async () => {
    const remote = await hub(), a = await client(remote), b = await client(remote);
    const bytes = Buffer.from("one immutable file");
    const ref = await a.blobs.publish(bytes, description);
    const first = b.blobs.resolve(ref), duplicate = b.blobs.resolve(ref);
    expect(duplicate).toBe(first);
    const variant = b.blobs.resolve({ ...ref, name: "same-content.pdf" });
    const [plain, pdf] = await Promise.all([first, variant]);
    expect(plain.endsWith(".txt")).toBe(true); expect(pdf.endsWith(".pdf")).toBe(true);
    expect(await fs.readFile(plain)).toEqual(bytes); expect(await fs.readFile(pdf)).toEqual(bytes);
    expect(remote.requests.filter(({ op }) => op === "get")).toHaveLength(1);
  });

  it("resumes verified ciphertext parts after an interrupted multi-chunk download", async () => {
    const remote = await hub(), a = await client(remote), b = await client(remote);
    const bytes = Buffer.alloc(BRIDGE_BLOB_CHUNK_BYTES + 31, 42), ref = await a.blobs.publish(bytes, description);
    remote.failures.add(`${ref.blobId}:1`);
    await expect(b.blobs.resolve(ref)).rejects.toThrow("503");
    await expect(b.blobs.resolve(ref)).resolves.toBeTypeOf("string");
    const file = await b.blobs.resolve(ref);
    expect(await fs.readFile(file)).toEqual(bytes);
    expect(remote.requests.filter(({ op, index }) => op === "get" && index === 0)).toHaveLength(1);
    expect(remote.requests.filter(({ op, index }) => op === "get" && index === 1)).toHaveLength(2);
  }, 15_000);

  it("waits for a captured snapshot already writing to disk before Stop completes", async () => {
    const { blobs } = await client(), entered = deferred(), gate = deferred();
    const write = vi.mocked(fs.writeFile).getMockImplementation()!;
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      if (String(args[0]).includes("/bridge/uploads/.pending-")) { entered.resolve(); await gate.promise; }
      return write(...args);
    });
    const capturing = blobs.capture(Buffer.from("An admitted snapshot"), description);
    await entered.promise;
    let closed = false;
    const closing = blobs.stop().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
    } finally { gate.resolve(); await capturing; await closing; vi.mocked(fs.writeFile).mockImplementation(write); }
  });

  it("refuses a new captured snapshot after transfer ownership is stopped", async () => {
    const { blobs, dataDir } = await client(); await blobs.stop();
    await expect(blobs.capture(Buffer.from("Do not stage after Stop"), description)).rejects.toThrow("stopped");
    await expect(fs.stat(join(dataDir, "bridge", "uploads"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
