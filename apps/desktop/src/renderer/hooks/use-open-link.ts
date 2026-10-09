import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { atlasPageHref } from "@mains/contracts/atlas";

import { toast } from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { isWeb } from "@/lib/platform";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { atlasPageIdFromHref } from "@/features/atlas/lib/page-link";
import { requestAtlasPage } from "@/features/atlas/lib/page-actions";
import { useGetAccountQuery } from "@/lib/redux/api/accountApi";
import { useAppSelector } from "@/lib/redux/hooks";

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
 * Page references open the app editor; web URLs use the desktop browser panel
 * or the external-link fallback for unsupported schemes and web mode.
 */
export function useOpenLink(): (url: string) => Promise<void> {
  const { openUrl } = useBrowserPanel();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { currentData: account } = useGetAccountQuery();
  const backendId = useAppSelector((state) => state.backends.activeBackendId);

  return useCallback(
    async (url: string) => {
      try {
        const pageId = atlasPageIdFromHref(url, window.location.href);
        if (pageId) {
          if (pathname === "/atlas" || pathname.startsWith("/atlas/")) {
            if (!account) throw new Error("Account unavailable");
            requestAtlasPage({ ownerKey: JSON.stringify([backendId ?? "local", account.id]), id: pageId });
          } else {
            void navigate(atlasPageHref(pageId));
          }
          return;
        }
        if (!isWeb && isInAppBrowserUrl(url)) {
          await openUrl(url);
          return;
        }
        await window.api.shell.openExternal(url);
      } catch (error) {
        toast.error(extractErrorMessage(error, "Failed to open link"));
      }
    },
    [openUrl, navigate, pathname, account, backendId],
  );
}
