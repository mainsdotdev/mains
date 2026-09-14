import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setTheme as setThemeAction,
  isThemePreference,
  type ThemePreference,
} from "@/lib/redux/slices/appSettingsSlice";
import { readPersistedAppSetting } from "@/lib/redux/persist-boot";

/**
 * Theme preference is redux state (persisted with the rest of `appSettings`),
 * but the `dark` class has to be on `<html>` before the first paint — and
 * rehydration is async, so waiting for the store would flash light-on-dark at
 * every launch. The module therefore seeds itself with one synchronous read of
 * the persisted value, then follows redux for the rest of the session.
 *
 * `darkMode` resolves "system" against the OS, which redux can't hold: it isn't
 * a preference, it's an observation that changes while the app runs. That lives
 * in the small external store below.
 */

const getSystemPreference = (): boolean => {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const updateDOM = (isDark: boolean): void => {
  document.documentElement.classList.toggle("dark", isDark);
};

// ─────────────────────────────────────────────────────────────
// System-preference store (OS-owned, not persisted)
// ─────────────────────────────────────────────────────────────

let systemPrefersDark = getSystemPreference();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): boolean => systemPrefersDark;
const getServerSnapshot = (): boolean => true;

const resolveDarkMode = (
  theme: ThemePreference,
  systemDark: boolean,
): boolean => (theme === "system" ? systemDark : theme === "dark");

if (typeof window !== "undefined") {
  // Pre-paint seed. Whatever redux rehydrates a tick later agrees with this in
  // every case except a corrupt blob, where the effect below corrects it.
  const bootTheme = readPersistedAppSetting(
    "theme",
    isThemePreference,
    "system",
  );
  updateDOM(resolveDarkMode(bootTheme, systemPrefersDark));

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      systemPrefersDark = e.matches;
      listeners.forEach((listener) => listener());
    });
}

export function useDarkMode() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((state) => state.appSettings.theme);
  const systemDark = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const darkMode = resolveDarkMode(theme, systemDark);

  // Every source of change — the user picking a theme, the OS flipping, redux
  // rehydrating — lands here, so the class is only written in one place.
  useEffect(() => {
    updateDOM(darkMode);
  }, [darkMode]);

  const setTheme = useCallback(
    (value: ThemePreference) => {
      dispatch(setThemeAction(value));
    },
    [dispatch],
  );

  const toggleDarkMode = useCallback(() => {
    dispatch(setThemeAction(darkMode ? "light" : "dark"));
  }, [dispatch, darkMode]);

  const setDarkMode = useCallback(
    (value: boolean) => {
      dispatch(setThemeAction(value ? "dark" : "light"));
    },
    [dispatch],
  );

  return { darkMode, theme, toggleDarkMode, setDarkMode, setTheme };
}

export type { ThemePreference };
