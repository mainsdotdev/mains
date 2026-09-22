import { useCallback, useLayoutEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setThemeChoice } from "@/lib/redux/slices/appSettingsSlice";
import {
  readPersistedAppSetting,
  readPersistedWorkspaceSetting,
} from "@/lib/redux/persist-boot";
import {
  DEFAULT_APP_THEME_SETTINGS,
  applyAppTheme,
  isAppThemeSettings,
  resolveAppTheme,
  themeChoiceFor,
  type AppThemeSettings,
  type ResolvedAppTheme,
  type ThemeChoiceChange,
} from "@/lib/app-themes";
import { getProviderVariantById } from "@/lib/provider-variants";
import { useActiveSpace } from "./use-active-space";

/**
 * Mirrors the app theme in force — the settings resolved for the active
 * provider — into the theme stylesheet (see `lib/app-themes.ts`).
 *
 * Like the dark class, it has to land before the first paint — rehydration is
 * async, and a theme repaints every surface, so waiting for the store would
 * flash the stock palette at every launch. The module therefore seeds itself
 * with one synchronous read of the persisted settings, then follows redux for
 * the rest of the session.
 *
 * The active provider comes from the active space, which arrives over IPC
 * after the first paint. Until it does, the provider last used on `/code`
 * (persisted by the workspace slice) stands in — normally the same one, so
 * the hand-over repaints nothing.
 */

const isString = (value: unknown): value is string => typeof value === "string";

function resolveFor(
  settings: AppThemeSettings,
  providerId: string | null,
): ResolvedAppTheme {
  const brandColor = providerId
    ? (getProviderVariantById(providerId)?.brandColor ?? null)
    : null;
  return resolveAppTheme(themeChoiceFor(settings, providerId), brandColor);
}

if (typeof window !== "undefined") {
  // Pre-paint seed. Whatever redux rehydrates a tick later agrees with this in
  // every case except a corrupt blob, where the hook below corrects it.
  applyAppTheme(
    document,
    resolveFor(
      readPersistedAppSetting(
        "appTheme",
        isAppThemeSettings,
        DEFAULT_APP_THEME_SETTINGS,
      ),
      readPersistedWorkspaceSetting<string | null>(
        "selectedProviderId",
        isString,
        null,
      ),
    ),
  );
}

/** The provider whose theme is in force. */
function useThemeProviderId(): string {
  const { activeSpace } = useActiveSpace();
  const lastUsed = useAppSelector((s) => s.workspace.selectedProviderId);
  return activeSpace?.providerId ?? lastUsed;
}

/** The app theme in force, resolved for the active provider. */
export function useResolvedAppTheme(): ResolvedAppTheme {
  const settings = useAppSelector((s) => s.appSettings.appTheme);
  const providerId = useThemeProviderId();
  return useMemo(
    () => resolveFor(settings, providerId),
    [settings, providerId],
  );
}

/** Applies the app theme in force. Mount once, at the app root. */
export function useAppTheme() {
  const theme = useResolvedAppTheme();

  useLayoutEffect(() => {
    applyAppTheme(document, theme);
  }, [theme]);
}

/** The theme settings and their one setter, for the settings page. */
export function useAppThemeSettings() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.appSettings.appTheme);
  const change = useCallback(
    (next: ThemeChoiceChange) => dispatch(setThemeChoice(next)),
    [dispatch],
  );
  return [settings, change] as const;
}
