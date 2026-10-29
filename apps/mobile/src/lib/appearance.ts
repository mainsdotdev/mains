import { eq } from "drizzle-orm";
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

import { db } from "@/db/client";
import { preferences } from "@/db/schema";

/**
 * Which light/dark appearance the app wears: whatever the phone is set to, or
 * an override this app applies to itself.
 *
 * The override goes through `Appearance.setColorScheme`, which sets
 * `overrideUserInterfaceStyle` on iOS windows and AppCompat night mode on
 * Android. Components subscribe through `useThemeColors` / `useColorScheme`.
 * iOS retains native semantic colors; Android sends fresh palette values to
 * existing view props. Components do not read the stored preference directly.
 */
const PREFERENCES = ["system", "light", "dark"] as const;

export type AppearancePreference = (typeof PREFERENCES)[number];

export const APPEARANCE_PREFERENCES: readonly AppearancePreference[] = PREFERENCES;

const KEY = "appearance";

const listeners = new Set<() => void>();

/** Read once on first use, then owned in memory; the table is written through. */
let current: AppearancePreference | null = null;

function isPreference(value: unknown): value is AppearancePreference {
  return PREFERENCES.includes(value as AppearancePreference);
}

function stored(): AppearancePreference {
  const row = db
    .select({ value: preferences.value })
    .from(preferences)
    .where(eq(preferences.key, KEY))
    .get();
  return isPreference(row?.value) ? row.value : "system";
}

export function appearancePreference(): AppearancePreference {
  current ??= stored();
  return current;
}

/**
 * Push the stored choice into the native appearance before the first render.
 * An effect fires after the first paint, which is exactly the frame that would
 * flash the phone's scheme before correcting itself.
 */
export function applyStoredAppearance(): void {
  apply(appearancePreference());
}

export function setAppearancePreference(preference: AppearancePreference): void {
  if (preference === appearancePreference()) return;
  current = preference;
  apply(preference);
  db.insert(preferences)
    .values({ key: KEY, value: preference })
    .onConflictDoUpdate({ target: preferences.key, set: { value: preference } })
    .run();
  for (const listener of listeners) listener();
}

export function useAppearancePreference(): AppearancePreference {
  return useSyncExternalStore(subscribe, appearancePreference, appearancePreference);
}

function apply(preference: AppearancePreference): void {
  // "unspecified" hands the app back to the phone's own setting.
  Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How each choice is named in the UI. */
export function appearanceLabel(preference: AppearancePreference): string {
  switch (preference) {
    case "system":
      return "System";
    case "light":
      return "Light";
    case "dark":
      return "Dark";
  }
}
