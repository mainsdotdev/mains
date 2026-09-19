import { app, nativeImage, type NativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";

export interface TrayIcons {
  normal: NativeImage;
  /** The same glyph wearing a badge — something is waiting on the user. */
  attention: NativeImage;
}

/**
 * Stamp a badge dot into the bottom-right corner of a raw 32-bit bitmap,
 * cutting a thin gap around it so it reads as separate from the glyph. Only
 * alpha carries meaning in a macOS template image (the system paints the mask),
 * so the dot is opaque black and the gap is transparent. Returns a copy.
 */
export function drawBadge(bitmap: Buffer, width: number, height: number): Buffer {
  const out = Buffer.from(bitmap);
  const radius = width * 0.19;
  const gap = width / 16;
  const cx = width - radius;
  const cy = height - radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const dot = Math.min(1, Math.max(0, radius + 0.5 - distance));
      const cut = Math.min(1, Math.max(0, radius + gap + 0.5 - distance));
      if (cut === 0) continue;
      const i = (y * width + x) * 4;
      const kept = out[i + 3] * (1 - cut);
      const alpha = Math.round(Math.max(kept, dot * 255));
      if (dot > 0) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
      }
      out[i + 3] = alpha;
    }
  }
  return out;
}

/**
 * The 1x menu-bar asset. macOS loads the `@2x` file sitting beside it on its
 * own, so this path is the only one anything needs to name — and the image
 * must not be resized afterwards, or the crisp representation is thrown away.
 * `menu-icon.png` in the same folder is the master the two are cut from
 * (`sips -z 16 16` / `-z 32 32`). Both must be **black + clear**: a template
 * image is shape, not artwork, and AppKit takes that shape from the black
 * content — the white master rendered as a pale smudge next to the system's
 * own icons until it was recoloured.
 */
function resolveIconPath(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), "src/renderer/public/menu-iconTemplate.png");
  }
  const packed = path.join(process.resourcesPath, "menu-iconTemplate.png");
  if (fs.existsSync(packed)) return packed;
  return path.join(app.getAppPath(), ".vite/renderer/menu-iconTemplate.png");
}

/** The badged copy of every representation (1x, 2x) the source carries. */
function withBadge(source: NativeImage): NativeImage {
  const size = source.getSize();
  const badged = nativeImage.createEmpty();
  for (const scaleFactor of source.getScaleFactors()) {
    const width = Math.round(size.width * scaleFactor);
    const height = Math.round(size.height * scaleFactor);
    const bitmap = source.toBitmap({ scaleFactor });
    if (bitmap.length !== width * height * 4) continue;
    badged.addRepresentation({
      scaleFactor,
      width,
      height,
      buffer: drawBadge(bitmap, width, height),
    });
  }
  return badged.isEmpty() ? source : badged;
}

export function loadTrayIcons(): TrayIcons {
  const iconPath = resolveIconPath();
  const source = nativeImage.createFromPath(iconPath);
  const isMac = process.platform === "darwin";
  // The asset is already menu-bar sized (16pt, with its @2x beside it), so on
  // macOS it goes through untouched: `resize` returns a new image that drops
  // both the extra representation and the template flag. Windows and Linux
  // have no template concept and take whatever they are given, so they keep
  // the explicit 16px.
  const normal = isMac ? source : source.resize({ width: 16, height: 16 });
  const attention = withBadge(normal);

  // Template = the alpha channel is a mask, not artwork: macOS paints it black
  // on a light menu bar and white on a dark one. Set explicitly rather than
  // relying on the `…Template.png` filename, which only marks the image at
  // load time — and never reaches the badged copy.
  if (isMac) {
    normal.setTemplateImage(true);
    attention.setTemplateImage(true);
  }

  // Which file this actually resolved to, and whether it arrived as a mask.
  // The path fallback above and the packaging step are both easy to get wrong
  // in a way that only shows up as a pale glyph in the menu bar.
  console.log(
    `Tray icon: ${iconPath} (exists=${fs.existsSync(iconPath)}, ` +
      `empty=${normal.isEmpty()}, template=${normal.isTemplateImage()}, ` +
      `badge scales=${attention.getScaleFactors().join(",")})`,
  );
  return { normal, attention };
}
