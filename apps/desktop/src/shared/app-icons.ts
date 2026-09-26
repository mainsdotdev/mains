/** Each Japanese palette has a color-inside and color-outside treatment. */
export const JAPANESE_GRADIENTS = [
  { name: "Fiery Dawn", inside: "mains-1", outside: "mains-9" },
  { name: "Golden Mist", inside: "mains-2", outside: "mains-10" },
  { name: "Amber Horizon", inside: "mains-3", outside: "mains-11" },
  { name: "Deep Sea", inside: "mains-4", outside: "mains-12" },
  { name: "Summer Coast", inside: "mains-5", outside: "mains-13" },
  { name: "Blue Depths", inside: "mains-6", outside: "mains-14" },
  { name: "Neon Sunset", inside: "mains-7", outside: "mains-15" },
  { name: "Purple Sunrise", inside: "mains-8", outside: "mains-16" },
] as const;

export const UPDATES = [
  { name: "Fiery Dawn", outside: "mains-17", inside: "mains-25" },
  { name: "Golden Mist", outside: "mains-18", inside: "mains-26" },
  { name: "Amber Horizon", outside: "mains-19", inside: "mains-27" },
  { name: "Deep Sea", outside: "mains-20", inside: "mains-28" },
  { name: "Summer Coast", outside: "mains-21", inside: "mains-29" },
  { name: "Blue Depths", outside: "mains-22", inside: "mains-30" },
  { name: "Neon Sunset", outside: "mains-23", inside: "mains-31" },
  { name: "Purple Sunrise", outside: "mains-24", inside: "mains-32" },
] as const;

export const DEFAULT_APP_ICON_ID = "mains-default" as const;
export const DARK_APP_ICON_ID = "mains-dark" as const;
export const LIGHT_APP_ICON_ID = "mains-light" as const;

export const APP_ICON_IDS = [
  DEFAULT_APP_ICON_ID,
  ...JAPANESE_GRADIENTS.map((gradient) => gradient.inside),
  ...JAPANESE_GRADIENTS.map((gradient) => gradient.outside),
  ...UPDATES.map((gradient) => gradient.inside),
  ...UPDATES.map((gradient) => gradient.outside),
  DARK_APP_ICON_ID,
  LIGHT_APP_ICON_ID,
] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];
const APP_ICON_ID_SET: ReadonlySet<string> = new Set(APP_ICON_IDS);

export function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === "string" && APP_ICON_ID_SET.has(value);
}

export function appIconAssetPath(id: AppIconId): string {
  return `icons/${id}.png`;
}
