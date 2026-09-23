/**
 * Colour math for the app theme engine (`app-themes.ts`): OKLab for mixing,
 * because a straight sRGB mix between a dark background and a light
 * foreground bunches its midpoints toward the dark end, and WCAG luminance
 * for contrast checks. Opaque `#rrggbb` only — that is how themes are written.
 */

/** sRGB channels, 0–1. */
type Rgb = readonly [number, number, number];
/** OKLab coordinates: lightness 0–1, then the a/b opponent axes. */
type Oklab = readonly [number, number, number];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOR.test(value);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function hexToRgb(hex: string): Rgb {
  if (!isHexColor(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const channel = (offset: number) =>
    parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) =>
      Math.round(clamp01(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const toLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
// Clipped first: an out-of-gamut channel can come back negative, and a
// fractional power of a negative number is NaN.
const fromLinear = (c: number): number => {
  const x = clamp01(c);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

export function hexToOklab(hex: string): Oklab {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Out-of-gamut results are clipped per channel. */
export function oklabToHex([L, a, b]: Oklab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbToHex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** `amount` 0 is `from`, 1 is `to`; the ends come back exactly as given. */
export function mixOklab(from: string, to: string, amount: number): string {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  const a = hexToOklab(from);
  const b = hexToOklab(to);
  return oklabToHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]);
}

/** Moves OKLab lightness by `delta`, keeping hue and chroma. */
export function shiftLightness(hex: string, delta: number): string {
  const [L, a, b] = hexToOklab(hex);
  return oklabToHex([clamp01(L + delta), a, b]);
}

export function oklabLightness(hex: string): number {
  return hexToOklab(hex)[0];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1–21. Order of the arguments doesn't matter. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}
