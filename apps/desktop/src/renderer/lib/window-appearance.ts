import { capabilities } from "./platform/capabilities";
import { themeFrameColor, type ResolvedAppTheme } from "./app-themes";
import type { WindowAppearance } from "@mains/contracts/window-appearance";

let sentAppearance: string | null = null;

/** Mirror the active provider's two appearances; main follows nativeTheme. */
export function syncWindowAppearance(theme: ResolvedAppTheme): void {
  const update = window.api?.app?.setWindowAppearance;
  if (!capabilities.windowsWindowChrome || !update) return;
  const appearance: WindowAppearance = {
    light: { translucent: theme.light.translucent, backgroundColor: themeFrameColor(theme.light, "light") },
    dark: { translucent: theme.dark.translucent, backgroundColor: themeFrameColor(theme.dark, "dark") },
  };
  const key = JSON.stringify(appearance);
  if (key === sentAppearance) return;
  sentAppearance = key;
  void update(appearance).then((result) => {
    if (!result.success && sentAppearance === key) sentAppearance = null;
  }, () => {
    if (sentAppearance === key) sentAppearance = null;
  });
}
