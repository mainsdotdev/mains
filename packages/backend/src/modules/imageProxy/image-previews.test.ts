import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureBackendRuntime, getBackendRuntime } from "../../runtime/backend-runtime";
import { drainImagePreviews, MAX_PREVIEW_SOURCE_BYTES, pruneImagePreviews, readImagePreview, removeImagePreviews } from "./image-previews";
import { MAX_IMAGE_SIZE, serveLocalImage } from "./imageProxy.local-serve";
import { signLocalImagePath } from "./imageProxy.signing";
import { imageProxyService } from "./imageProxy.service";

let root: string;
let source: string;
let restore: () => void;
let decoding = 0;
let peak = 0;
const codec = vi.fn(async (bytes: Buffer, side: number, alpha = false) => {
  peak = Math.max(peak, ++decoding);
  await new Promise<void>((resolve) => setImmediate(resolve));
  decoding--;
  return { bytes: Buffer.from(`preview:${bytes.subarray(0, 8)}:${side}:${alpha}`),
    mime: alpha ? "image/png" as const : "image/jpeg" as const, width: side, height: side / 2 };
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mains-preview-"));
  source = path.join(root, "image.png");
  await fs.writeFile(source, "original");
  codec.mockClear(); decoding = 0; peak = 0;
  restore = configureBackendRuntime({ ...getBackendRuntime(), getPath: () => root, imagePreview: { resize: codec } });
});
afterEach(async () => {
  await drainImagePreviews();
  restore();
  await fs.rm(root, { recursive: true, force: true });
});

async function cacheFiles() {
  return (await fs.readdir(path.join(root, "cache", "image-previews"), { recursive: true }))
    .filter((name) => name.endsWith(".bin"));
}

describe("shared image previews", () => {
  it("deduplicates requests, serializes sizes and retains every Atlas size on disk", async () => {
    const [first, duplicate] = await Promise.all([
      readImagePreview(source, 256), readImagePreview(source, 256), readImagePreview(source, 768), readImagePreview(source, 2048),
    ]);
    expect(first).toEqual(duplicate);
    expect(peak).toBe(1);
    expect(codec).toHaveBeenCalledTimes(3);
    for (const side of [256, 768, 2048]) expect((await readImagePreview(source, side)).width).toBe(side);
    expect(codec).toHaveBeenCalledTimes(3);
    expect(await cacheFiles()).toHaveLength(3);
    expect(await fs.readFile(source, "utf8")).toBe("original");
  });

  it("separates alpha-preserving previews and disposable chat modal previews", async () => {
    expect((await readImagePreview(source, 256, { preserveAlpha: true })).mime).toBe("image/png");
    expect((await readImagePreview(source, 256)).mime).toBe("image/jpeg");
    await readImagePreview(source, 1600, { cache: false });
    await readImagePreview(source, 1600, { cache: false });
    expect(codec).toHaveBeenCalledTimes(4);
    expect(await cacheFiles()).toHaveLength(2);
  });

  it("invalidates changed sources and regenerates a corrupted derivative", async () => {
    const first = await readImagePreview(source, 768);
    await fs.writeFile(source, "updated!");
    await fs.utimes(source, new Date(), new Date(Date.now() + 1000));
    const updated = await readImagePreview(source, 768);
    expect(updated.bytes).not.toEqual(first.bytes);
    for (const file of await cacheFiles()) await fs.writeFile(path.join(root, "cache", "image-previews", file), "broken");
    expect((await readImagePreview(source, 768)).bytes).toEqual(updated.bytes);
    expect(codec).toHaveBeenCalledTimes(3);
  });

  it("evicts least recently used derivatives and cleans up only the requested source", async () => {
    await readImagePreview(source, 256);
    const other = path.join(root, "other.png");
    await fs.writeFile(other, "second");
    const second = await readImagePreview(other, 256);
    const files = await cacheFiles();
    // Set explicit access order instead of relying on filesystem clock resolution.
    for (const file of files) {
      const full = path.join(root, "cache", "image-previews", file);
      if ((await fs.readFile(full)).includes(Buffer.from("original"))) await fs.utimes(full, new Date(0), new Date(0));
    }
    await pruneImagePreviews(second.bytes.length);
    expect(await cacheFiles()).toHaveLength(1);
    expect(await fs.readFile(source, "utf8")).toBe("original");
    await removeImagePreviews(other);
    expect(await cacheFiles()).toHaveLength(0);
    expect(await fs.readFile(other, "utf8")).toBe("second");
  });

  it("rejects missing originals, symlinks and invalid sizes before using cached bytes", async () => {
    await readImagePreview(source, 256);
    await fs.rm(source);
    await expect(readImagePreview(source, 256)).rejects.toThrow();
    await fs.symlink(path.join(root, "missing.png"), source);
    await expect(readImagePreview(source, 256)).rejects.toThrow("Invalid image file");
    await expect(readImagePreview(source, 99999)).rejects.toThrow("Invalid image preview size");
    expect(codec).toHaveBeenCalledTimes(1);
  });

  it("shares and removes previews through equivalent directory aliases", async () => {
    const alias = path.join(root, "alias");
    await fs.symlink(root, alias);
    await readImagePreview(source, 256);
    await readImagePreview(path.join(alias, "image.png"), 256);
    expect(codec).toHaveBeenCalledTimes(1);
    await removeImagePreviews(path.join(alias, "image.png"));
    expect(await cacheFiles()).toHaveLength(0);
    expect(await fs.readFile(source, "utf8")).toBe("original");
  });
});

describe("signed local previews", () => {
  it("serves the derivative and rejects changed, removed or unsigned size parameters", async () => {
    const signed = new URL(signLocalImagePath(source, 60_000, 768));
    const response = await serveLocalImage(signed);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toContain(":768:true");
    signed.searchParams.set("size", "2048");
    expect((await serveLocalImage(signed)).status).toBe(403);
    signed.searchParams.delete("size");
    expect((await serveLocalImage(signed)).status).toBe(403);
    const original = new URL(signLocalImagePath(source));
    expect(await (await serveLocalImage(original)).text()).toBe("original");
    original.searchParams.set("size", "256");
    expect((await serveLocalImage(original)).status).toBe(403);
    original.searchParams.set("size", "999999");
    expect((await serveLocalImage(original)).status).toBe(400);
    expect(imageProxyService.signLocalImageUrl(source, undefined, 999999 as any)).toBeNull();
  });

  it("previews sources larger than the original-serving limit while bounding source reads", async () => {
    await fs.truncate(source, MAX_IMAGE_SIZE + 1);
    expect((await serveLocalImage(new URL(signLocalImagePath(source)))).status).toBe(413);
    expect((await serveLocalImage(new URL(signLocalImagePath(source, 60_000, 256)))).status).toBe(200);
    await fs.truncate(source, MAX_PREVIEW_SOURCE_BYTES + 1);
    expect((await serveLocalImage(new URL(signLocalImagePath(source, 60_000, 256)))).status).toBe(413);
  });
});
