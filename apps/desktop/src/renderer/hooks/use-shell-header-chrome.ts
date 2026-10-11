import { useEffect, useState } from "react";
import { useCapabilities } from "@/lib/platform";

export function getCollapsedHeaderPaddingLeft(sidebarCollapsed: boolean | undefined, windowChrome: boolean, isFullscreen: boolean): string | undefined {
  if (!sidebarCollapsed) return undefined;
  return windowChrome && !isFullscreen ? "4.5rem" : "3rem";
}

/** Native window controls have one spacing policy across every header owner. */
export function useShellHeaderChrome(sidebarCollapsed?: boolean) {
  const { windowChrome, macWindowChrome } = useCapabilities();
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!windowChrome) return;
    return window.api.app.onFullscreenChange(setIsFullscreen);
  }, [windowChrome]);
  const reserveTrafficLights = macWindowChrome && !isFullscreen;
  return {
    sidebarToggleLeft: reserveTrafficLights ? "5.25rem" : "0.75rem",
    mainInsetLeft: getCollapsedHeaderPaddingLeft(sidebarCollapsed, macWindowChrome, isFullscreen),
    previewInsetLeft: sidebarCollapsed && reserveTrafficLights ? "5rem" : undefined,
  };
}
