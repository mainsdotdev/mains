import sharp from "sharp";
import type { ImagePreviewAdapter } from "@mains/backend/runtime/backend-runtime";

// A single preview queue in the backend bounds concurrent decodes. Keep the
// native codec cache small too; attachment originals are already durable.
sharp.cache({ memory: 8, files: 0, items: 16 });
sharp.concurrency(1);

export const serverImagePreview: ImagePreviewAdapter = {
  async resize(bytes, maxSide, preserveAlpha = false) {
    try {
      const source = sharp(bytes, { animated: false });
      const hasAlpha = preserveAlpha && (await source.metadata()).hasAlpha;
      const resized = source
        .rotate()
        .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
      const encoded = hasAlpha ? resized.png() : resized.flatten({ background: "#ffffff" }).jpeg({ quality: 82 });
      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      return { bytes: data, mime: hasAlpha ? "image/png" : "image/jpeg", width: info.width, height: info.height };
    } catch {
      return null;
    }
  },
};
