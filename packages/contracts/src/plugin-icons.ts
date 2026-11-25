export const MOBILE_PLUGIN_ICONS_CAPABILITY = "mobilePluginIcons";
export const MOBILE_PLUGIN_ICON_BATCH_SIZE = 8;

export interface MobilePluginIcon {
  vendorId: string;
  label: string;
  brandColor?: string;
  /** A raster thumbnail at most 64 px per side and 32 KiB before base64. */
  imageBase64?: string;
}

export function normalizePluginSlug(value: string): string {
  return value.toLowerCase().replace(/[\s._-]+/g, "");
}
