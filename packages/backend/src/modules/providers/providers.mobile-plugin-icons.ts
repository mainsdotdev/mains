import { MOBILE_PLUGIN_ICON_BATCH_SIZE, normalizePluginSlug, type MobilePluginIcon } from "@mains/contracts/plugin-icons";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { imageProxyService } from "../imageProxy";
import { providersService } from "./providers.service";

const LOGO_SOURCE_BYTES = 512 * 1024;
const ICON_BYTES = 32 * 1024;
const ICON_SIDE = 64;

export async function readMobilePluginIcons(input: unknown, signal?: AbortSignal): Promise<MobilePluginIcon[]> {
  if (!Array.isArray(input) || input.length > MOBILE_PLUGIN_ICON_BATCH_SIZE ||
      !input.every(id => typeof id === "string" && id.length <= 128 && normalizePluginSlug(id))) {
    throw new Error("Invalid plugin icon request");
  }
  const pending = new Set<string>(input.map(normalizePluginSlug));
  if (!pending.size) return [];
  signal?.throwIfAborted();
  const catalog = await providersService.getInstalledPlugins(PROVIDER_IDS.codex);
  signal?.throwIfAborted();

  const matches: Array<Promise<MobilePluginIcon | undefined>> = [];
  for (const { plugins } of catalog.marketplaces) {
    for (const plugin of plugins) {
      const info = plugin.interface;
      if (!plugin.installed || !info) continue;
      const brandColor = /^#?[0-9a-f]{6}$/i.test(info.brandColor ?? "") ? info.brandColor : undefined;
      if (!info.logo && !brandColor) continue;
      const vendorIds = [...new Set([plugin.name, plugin.id.split("@")[0], info.displayName ?? ""].map(normalizePluginSlug))]
        .filter(id => pending.delete(id));
      if (!vendorIds.length) continue;
      // Alternate spellings can refer to the same artwork. Decode once.
      const image = thumbnail(info.logo, signal);
      const label = (info.displayName || plugin.name || vendorIds[0]).slice(0, 128);
      for (const vendorId of vendorIds) {
        matches.push(image.then(imageBase64 => {
          if (!imageBase64 && !brandColor) return undefined;
          const icon: MobilePluginIcon = { vendorId, label };
          if (brandColor) icon.brandColor = brandColor;
          if (imageBase64) icon.imageBase64 = imageBase64;
          return icon;
        }));
      }
      if (!pending.size) break;
    }
    if (!pending.size) break;
  }
  const icons = await Promise.all(matches);
  signal?.throwIfAborted();
  return icons.filter(icon => icon !== undefined);
}

async function thumbnail(logo: string | undefined, signal?: AbortSignal): Promise<string | undefined> {
  const codec = getBackendRuntime().imagePreview;
  if (!logo || !codec) return undefined;
  try {
    const bytes = await logoBytes(logo, signal);
    if (!bytes?.length || signal?.aborted) return undefined;
    const image = await codec.resize(bytes, ICON_SIDE, true);
    if (image?.bytes.length && image.bytes.length <= ICON_BYTES &&
        image.width >= 1 && image.height >= 1 && Math.max(image.width, image.height) <= ICON_SIDE &&
        (image.mime === "image/png" || image.mime === "image/jpeg")) return image.bytes.toString("base64");
  } catch {
    // Artwork is optional. The caller can still render the brand color.
  }
  return undefined;
}

async function logoBytes(logo: string, owner?: AbortSignal): Promise<Buffer | undefined> {
  if (/^data:/i.test(logo)) {
    if (logo.length > Math.ceil(LOGO_SOURCE_BYTES / 3) * 4 + 64) return undefined;
    const match = /^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml);base64,([a-z0-9+/]+={0,2})$/i.exec(logo);
    if (!match) return undefined;
    const bytes = Buffer.from(match[1], "base64");
    return bytes.length <= LOGO_SOURCE_BYTES ? bytes : undefined;
  }
  if (!/^https?:\/\//i.test(logo)) return undefined;

  const timeout = AbortSignal.timeout(6_000);
  const signal = owner ? AbortSignal.any([owner, timeout]) : timeout;
  // The source comes only from the installed catalog, without GitHub credentials.
  const response = await imageProxyService.safeImageFetch(logo, null, signal);
  if (!response.ok || Number(response.headers.get("content-length")) > LOGO_SOURCE_BYTES) {
    await response.body?.cancel();
    return undefined;
  }
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > LOGO_SOURCE_BYTES) return undefined;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
