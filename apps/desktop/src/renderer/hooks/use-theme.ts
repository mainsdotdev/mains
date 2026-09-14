import { useMemo } from "react";
import { useActiveSpace } from "./use-active-space";
import { useDarkMode } from "./use-dark-mode";
import { getDefaultBackground } from "@/lib/theme";
import { parseThemeConfig } from "@/lib/parse-theme-config";

export interface ThemeConfig {
  backgroundColor?: string;
}

/**
 * Hook to get theme configuration from active space's themeConfig.
 * Automatically switches between light/dark variants based on app theme.
 */
export function useTheme(): ThemeConfig {
  const { activeSpace } = useActiveSpace();
  const { darkMode } = useDarkMode();
  const raw = activeSpace?.themeConfig ?? null;

  return useMemo(() => {
    const defaultBg = getDefaultBackground(darkMode);
    const config = parseThemeConfig(raw);

    if (config.lightBackground && config.darkBackground) {
      return {
        backgroundColor: darkMode ? config.darkBackground : config.lightBackground,
      };
    }
    if (config.light?.value && config.dark?.value) {
      return {
        backgroundColor: darkMode ? config.dark.value : config.light.value,
      };
    }
    if (config.backgroundColor) {
      return { backgroundColor: config.backgroundColor };
    }
    return { backgroundColor: defaultBg };
  }, [raw, darkMode]);
}
