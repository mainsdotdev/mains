import sharp from "sharp";
import type { ImagePreviewAdapter } from "@mains/backend/runtime/backend-runtime";

// A single preview queue in the backend bounds concurrent decodes. Keep the
// native codec cache small too; attachment originals are already durable.
sharp.cache({ memory: 8, files: 0, items: 16 });
sharp.concurrency(1);

export const serverImagePreview: ImagePreviewAdapter = {
  async resizeToJpeg(bytes, maxSide) {
    try {
      const { data, info } = await sharp(bytes, { animated: false })
        .rotate()
        .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      return { jpeg: data, width: info.width, height: info.height };
    } catch {
      return null;
    }
  },
};
