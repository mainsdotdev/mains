// Keep this list aligned with LOCALIMG_EXT_MIME in imageProxy.local-serve.ts.
const PREVIEWABLE_IMAGE_EXTENSIONS = new Set([
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

export function isPreviewableImagePath(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? filePath;
  const dot = name.lastIndexOf(".");
  return dot > 0 && PREVIEWABLE_IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
