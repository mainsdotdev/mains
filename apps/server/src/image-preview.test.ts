import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { serverImagePreview } from "./image-preview";

describe("standalone image previews", () => {
  it("decodes real PNG originals into capped JPEG thumbnails and previews", async () => {
    const original = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 20, g: 60, b: 90, alpha: 0.5 } } }).png().toBuffer();
    for (const side of [256, 1600]) {
      const image = await serverImagePreview.resizeToJpeg(original, side);
      expect(image?.width).toBe(side);
      expect(image!.height).toBeLessThanOrEqual(side);
      expect((await sharp(image!.jpeg).metadata()).format).toBe("jpeg");
    }
    expect((await sharp(original).metadata()).width).toBe(3000);
  });

  it("does not enlarge small images and rejects undecodable data", async () => {
    const original = await sharp({ create: { width: 20, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    expect(await serverImagePreview.resizeToJpeg(original, 256)).toMatchObject({ width: 20, height: 10 });
    expect(await serverImagePreview.resizeToJpeg(Buffer.from("invalid image"), 256)).toBeNull();
  });
});
