import { useCallback } from "react";

import { toast } from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { isWeb } from "@/lib/platform";
import { useBrowserPanel } from "@/hooks/use-browser-panel";

/** Only URLs the embedded browser explicitly supports belong in its panel. */
export function isInAppBrowserUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Open web URLs in the desktop browser panel while preserving the platform's
 * existing external-link fallback for unsupported schemes and web mode.
 */
export function useOpenLink(): (url: string) => Promise<void> {
  const { openUrl } = useBrowserPanel();

  return useCallback(
    async (url: string) => {
      try {
        if (!isWeb && isInAppBrowserUrl(url)) {
          await openUrl(url);
          return;
        }
        await window.api.shell.openExternal(url);
      } catch (error) {
        toast.error(extractErrorMessage(error, "Failed to open link"));
      }
    },
    [openUrl],
  );
}
