/** The local image protocol only accepts these bounded derivative sizes. */
export const LOCAL_IMAGE_PREVIEW_SIZES = [256, 768, 2048] as const;
export type LocalImagePreviewSize = typeof LOCAL_IMAGE_PREVIEW_SIZES[number];

export function isLocalImagePreviewSize(value: unknown): value is LocalImagePreviewSize {
  return LOCAL_IMAGE_PREVIEW_SIZES.some((size) => size === value);
}
