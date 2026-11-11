import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { createPrAttachmentStorage } from "./pr-attachment-storage";
import { PR_ATTACHMENT_CHUNK_BYTES, PR_IMAGE_MAX_BYTES } from "@mains/contracts/pr-attachments";
const native = vi.hoisted(() => ({ remove: vi.fn(), write: vi.fn() }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  native.remove.mockImplementation(fs.rm);
  native.write.mockImplementation(fs.writeFile);
  return { ...fs, rm: native.remove, writeFile: native.write };
});
beforeEach(() => { native.remove.mockClear(); });

const stores: ReturnType<typeof createPrAttachmentStorage>[] = [];
const storage = () => { const store = createPrAttachmentStorage(); stores.push(store); return store; };
const chunk = (extra = {}) => ({ workspaceId: "ws", name: "image.png", size: 6, offset: 0, data: Buffer.from("abc").toString("base64"), ...extra });
afterEach(async () => { await Promise.all(stores.splice(0).map((store) => store.dispose())); });

describe("PR attachment storage", () => {
  it("accepts a full transport-sized chunk without truncation", async () => {
    const store = storage();
    const bytes = Buffer.alloc(PR_ATTACHMENT_CHUNK_BYTES, 42);
    const { uploadId } = await store.write(chunk({ size: bytes.length, data: bytes.toString("base64") }));
    const claim = store.claim("ws", [uploadId]);
    // Buffer#equals, not toEqual: a deep compare of 1 MB takes seconds and times out on CI.
    expect((await readFile(claim.paths[0])).equals(bytes)).toBe(true);
    await claim.release();
  });
  it("assembles ordered chunks, locks them during creation, and removes temporary files", async () => {
    const store = storage();
    const { uploadId } = await store.write(chunk());
    expect(() => store.claim("ws", [uploadId])).toThrow("incomplete");
    await store.write(chunk({ uploadId, offset: 3, data: Buffer.from("def").toString("base64") }));
    const claim = store.claim("ws", [uploadId]);
    const path = claim.paths[0];
    expect(await readFile(path, "utf8")).toBe("abcdef");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(() => store.claim("ws", [uploadId])).toThrow("unavailable");
    await store.discard("ws", [uploadId]);
    await expect(access(path)).resolves.toBeUndefined();
    await claim.release();
    await expect(access(dirname(path))).rejects.toThrow();
  });

  it("waits for the creating PR to release its files before disposal", async () => {
    const store = storage();
    const { uploadId } = await store.write(chunk({ size: 3 }));
    const claim = store.claim("ws", [uploadId]);
    let closed = false; const closing = store.dispose().then(() => { closed = true; });
    try {
      expect(native.remove).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(await readFile(claim.paths[0], "utf8")).toBe("abc");
    } finally { await claim.release(); await closing; }
  });

  it("joins an admitted write before disposing its temporary directory", async () => {
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    native.write.mockImplementationOnce(async (...args: Parameters<typeof fs.writeFile>) => { entered(); await gate; return fs.writeFile(...args); });
    const store = storage(), pending = store.write(chunk({ size: 3 })); await writing;
    let closed = false; const closing = store.dispose().then(() => { closed = true; });
    try { await new Promise<void>((resolve) => setImmediate(resolve)); expect(closed).toBe(false); }
    finally { release(); await pending; await closing; }
    const file = native.write.mock.calls.at(-1)![0] as string;
    await expect(access(dirname(file))).rejects.toThrow();
    await expect(store.write(chunk({ size: 3 }))).rejects.toThrow("closed");
  });

  it("retains a failed purge for retry and never makes its files claimable again", async () => {
    const store = storage();
    const { uploadId } = await store.write(chunk({ size: 3 }));
    const claim = store.claim("ws", [uploadId]);
    native.remove.mockRejectedValueOnce(new Error("File busy"));
    await expect(claim.release()).rejects.toThrow("File busy");
    expect(() => store.claim("ws", [uploadId])).toThrow("unavailable");
    await expect(claim.release()).resolves.toBeUndefined();
    await expect(access(dirname(claim.paths[0]))).rejects.toThrow();
  });

  it("returns files to retry ownership after a failed PR and fences the old lease", async () => {
    const store = storage(), { uploadId } = await store.write(chunk({ size: 3 }));
    const first = store.claim("ws", [uploadId]); await first.release({ retain: true });
    const retry = store.claim("ws", [uploadId]); await first.release();
    expect(await readFile(retry.paths[0], "utf8")).toBe("abc");
    expect(() => store.claim("ws", [uploadId])).toThrow("unavailable");
    await retry.release();
  });

  it("does not let another workspace read, append, or discard an upload", async () => {
    const store = storage();
    const { uploadId } = await store.write(chunk({ size: 3 }));
    expect(() => store.claim("other", [uploadId])).toThrow();
    await expect(store.write(chunk({ workspaceId: "other", uploadId, offset: 3 }))).rejects.toThrow();
    await store.discard("other", [uploadId]);
    const claim = store.claim("ws", [uploadId]);
    expect(await readFile(claim.paths[0], "utf8")).toBe("abc");
    await claim.release();
  });

  it("rejects oversized, malformed and out-of-order chunks without consuming a valid upload", async () => {
    const store = storage();
    await expect(store.write(chunk({ size: PR_IMAGE_MAX_BYTES + 1 }))).rejects.toThrow("limit");
    await expect(store.write(chunk({ size: PR_ATTACHMENT_CHUNK_BYTES + 1, data: Buffer.alloc(PR_ATTACHMENT_CHUNK_BYTES + 1).toString("base64") }))).rejects.toThrow();
    await expect(store.write(chunk({ data: "not base64" }))).rejects.toThrow();
    const { uploadId } = await store.write(chunk());
    await expect(store.write(chunk({ uploadId, offset: 0 }))).rejects.toThrow("out of order");
    await store.write(chunk({ uploadId, offset: 3 }));
    expect(() => store.claim("ws", [uploadId, uploadId])).toThrow("Invalid");
    await store.claim("ws", [uploadId]).release();
  });

  it("sanitizes path separators and gh alt-text syntax while preserving the media extension", async () => {
    const store = storage();
    const { uploadId } = await store.write(chunk({ size: 3, name: "../../bad#name.png" }));
    const claim = store.claim("ws", [uploadId]);
    expect(claim.paths[0]).toMatch(/mains-pr-media-[^/]+\/.._.._bad_name\.png$/);
    await claim.release();
  });
  it("retries cleanup of a failed write when the first filesystem removal also fails", async () => {
    const store = storage();
    native.write.mockRejectedValueOnce(new Error("Disk full"));
    native.remove.mockRejectedValueOnce(new Error("File busy"));
    await expect(store.write(chunk({ size: 3 }))).rejects.toThrow();
    const file = native.write.mock.calls.at(-1)![0] as string;
    await store.dispose();
    await expect(access(dirname(file))).rejects.toThrow();
  });

  it("expires abandoned chunks without collecting a file owned by an active PR", async () => {
    const store = storage(), incomplete = await store.write(chunk());
    const complete = await store.write(chunk({ size: 3 }));
    const claim = store.claim("ws", [complete.uploadId]);
    const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now + 31 * 60_000);
    try {
      await store.write(chunk()); // Staging opportunistically runs TTL collection.
      expect(() => store.claim("ws", [incomplete.uploadId])).toThrow("unavailable");
      expect(await readFile(claim.paths[0], "utf8")).toBe("abc");
    } finally { clock.mockRestore(); await claim.release(); }
  });

  it("acknowledges a created PR while retaining its failed private-body cleanup for close", async () => {
    const store = storage(); let bodyPath = "";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    native.remove.mockRejectedValueOnce(new Error("File busy"));
    try {
      await expect(store.withBody("Private draft", async (file) => { bodyPath = file; return "created-pr"; })).resolves.toBe("created-pr");
      expect(await readFile(bodyPath, "utf8")).toBe("Private draft");
      await store.dispose();
      await expect(access(dirname(bodyPath))).rejects.toThrow();
    } finally { log.mockRestore(); }
  });

});
