import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { serverImagePreview } from "./image-preview";

describe("standalone image previews", () => {
  it("decodes real PNG originals into capped JPEG thumbnails and previews", async () => {
    const original = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 20, g: 60, b: 90, alpha: 0.5 } } }).png().toBuffer();
    for (const side of [256, 1600]) {
      const image = await serverImagePreview.resize(original, side);
      expect(image?.width).toBe(side);
      expect(image!.height).toBeLessThanOrEqual(side);
      expect((await sharp(image!.bytes).metadata()).format).toBe("jpeg");
    }
    expect((await sharp(original).metadata()).width).toBe(3000);
  });

  it("does not enlarge small images and rejects undecodable data", async () => {
    const original = await sharp({ create: { width: 20, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    expect(await serverImagePreview.resize(original, 256)).toMatchObject({ width: 20, height: 10 });
    expect(await serverImagePreview.resize(Buffer.from("invalid image"), 256)).toBeNull();
  });

  it("preserves transparency and aspect ratio for Atlas previews", async () => {
    const original = await sharp({ create: { width: 3000, height: 1500, channels: 4,
      background: { r: 20, g: 60, b: 90, alpha: 0.5 } } }).png().toBuffer();
    for (const side of [256, 768, 2048]) {
      const image = await serverImagePreview.resize(original, side, true);
      expect(image).toMatchObject({ mime: "image/png", width: side, height: side / 2 });
      const decoded = await sharp(image!.bytes).raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.channels).toBe(4);
      expect(decoded.data[3]).toBeGreaterThan(0);
      expect(decoded.data[3]).toBeLessThan(255);
    }
    const chat = await serverImagePreview.resize(original, 256);
    expect(chat?.mime).toBe("image/jpeg");
    expect((await sharp(chat!.bytes).metadata()).hasAlpha).toBe(false);
  });
});
