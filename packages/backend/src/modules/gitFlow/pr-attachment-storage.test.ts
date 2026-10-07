import { afterEach, describe, expect, it } from "vitest";
import { access, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { createPrAttachmentStorage } from "./pr-attachment-storage";
import { PR_ATTACHMENT_CHUNK_BYTES, PR_IMAGE_MAX_BYTES } from "@mains/contracts/pr-attachments";

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
});
