export const DEFAULT_APP_ICON_ID = "mains-default" as const;
export const ATLAS_APP_ICON_ID = "mains-atlas" as const;

export const APP_ICON_IDS = [
  DEFAULT_APP_ICON_ID,
  ATLAS_APP_ICON_ID,
] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];
export type AppIconAppearance = "light" | "dark";
const APP_ICON_ID_SET: ReadonlySet<string> = new Set(APP_ICON_IDS);

export function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === "string" && APP_ICON_ID_SET.has(value);
}

export function appIconAssetPath(id: AppIconId, appearance: AppIconAppearance = "light"): string {
  // Keep the saved Atlas preference while using the new Icon Composer source.
  const name = id === ATLAS_APP_ICON_ID ? "atlas" : id;
  return `icons/${name}${appearance === "dark" ? "-dark" : ""}.png`;
}
