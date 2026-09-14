import { useMemo } from "react";
import { useActiveSpace } from "./use-active-space";
import { useDarkMode } from "./use-dark-mode";
import { getDefaultDropdownBackground } from "@/lib/theme";
import { parseThemeConfig } from "@/lib/parse-theme-config";

/**
 * Computes the dropdown background color/gradient for the active space.
 * Pass `disabled = true` to skip the lookup (caller uses a fixed background instead).
 */
export function useDropdownBackground(
  opacity?: number,
  disabled = false,
): string | undefined {
  const { activeSpace } = useActiveSpace();
  const { darkMode } = useDarkMode();
  const raw = activeSpace?.themeConfig ?? null;

  return useMemo(() => {
    if (disabled) return undefined;

    const fallback = () =>
      opacity === undefined
        ? getDefaultDropdownBackground(darkMode)
        : getDefaultDropdownBackground(darkMode, opacity);

    const cfg = parseThemeConfig(raw);
    const bgColor = darkMode ? cfg.darkBackground : cfg.lightBackground;
    if (!bgColor) return fallback();
    if (bgColor.startsWith("linear-gradient")) return bgColor;
    return bgColor.length === 9 ? bgColor.slice(0, 7) : bgColor;
  }, [disabled, raw, darkMode, opacity]);
}
