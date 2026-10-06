export const RISOGRAPH_ICONS = [
  { id: "risograph/navy-orange", name: "Navy Orange" },
  { id: "risograph/pink-orange", name: "Pink Orange" },
  { id: "risograph/pink-blush", name: "Pink Blush" },
  { id: "risograph/orange-violet", name: "Orange Violet" },
  { id: "risograph/cocoa-blush", name: "Cocoa Blush" },
  { id: "risograph/cobalt-pink", name: "Cobalt Pink" },
  { id: "risograph/chartreuse-lilac", name: "Chartreuse Lilac" },
  { id: "risograph/mocha-cream", name: "Mocha Cream" },
] as const;

export const DEFAULT_APP_ICON_ID = "mains-default" as const;
export const DARK_APP_ICON_ID = "mains-dark" as const;
export const LIGHT_APP_ICON_ID = "mains-light" as const;
export const BLUE_APP_ICON_ID = "mains-blue" as const;
export const RED_APP_ICON_ID = "mains-red" as const;
export const YELLOW_APP_ICON_ID = "mains-yellow" as const;
export const PURPLE_APP_ICON_ID = "mains-purple" as const;
export const GREEN_APP_ICON_ID = "mains-green" as const;

export const APP_ICON_IDS = [
  DEFAULT_APP_ICON_ID,
  ...RISOGRAPH_ICONS.map((icon) => icon.id),
  DARK_APP_ICON_ID,
  LIGHT_APP_ICON_ID,
  BLUE_APP_ICON_ID,
  RED_APP_ICON_ID,
  YELLOW_APP_ICON_ID,
  PURPLE_APP_ICON_ID,
  GREEN_APP_ICON_ID,
] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];
const APP_ICON_ID_SET: ReadonlySet<string> = new Set(APP_ICON_IDS);

export function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === "string" && APP_ICON_ID_SET.has(value);
}

export function appIconAssetPath(id: AppIconId): string {
  return `icons/${id.replace("risograph/", "")}.png`;
}
