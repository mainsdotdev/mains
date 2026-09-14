import { useEffect, useState } from "react";

/** Below this width we switch to the mobile (single-column, drawer) layout. */
const MOBILE_QUERY = "(max-width: 767px)";

function matches(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

/**
 * Reactive form-factor hook: true on a narrow (phone) viewport. This is the
 * *layout* axis — independent of platform (a narrow Electron window is "mobile"
 * too). Use it to switch between desktop and mobile layouts; use
 * {@link useCapabilities} for feature gating.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => matches(MOBILE_QUERY));

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
