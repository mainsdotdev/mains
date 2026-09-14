import { useEffect, useState, type ReactNode } from "react";
import { useMainHeader } from "@/hooks/use-main-header";
import { useCapabilities } from "@/lib/platform";
import { LAYOUT_PANEL_ANIM_MS } from "@/lib/layout";

interface MainContentProps {
  children: ReactNode;
  marginLeft: string;
  marginRight: string;
  /**
   * Room to keep clear on the right *inside* the content surface, for something
   * that floats over it (the session box). Published as a CSS variable rather
   * than applied here: unlike `marginRight` it must not shrink the surface (that
   * would expose the translucent window behind it), and only the regions the box
   * actually covers should honour it — the bottom terminal stays full width.
   * Consumed via the `content-inset` utility.
   */
  contentInsetRight?: string;
  hasRightPanel?: boolean;
  sidebarCollapsed?: boolean;
  browserOpen?: boolean;
}

export function MainContent({
  children,
  marginLeft,
  marginRight,
  contentInsetRight,
  hasRightPanel,
  sidebarCollapsed,
  browserOpen,
}: MainContentProps) {
  const { header, firstTabActive } = useMainHeader();
  const { windowChrome } = useCapabilities();
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    return window.api.app.onFullscreenChange(setIsFullscreen);
  }, []);

  // When the sidebar is collapsed, its toggle and active mode stay in the
  // titlebar. Keep tabs clear of that cluster; native chrome needs additional
  // room for the macOS traffic lights to its left.
  const reserveTrafficLights = windowChrome && !isFullscreen;
  const headerPaddingLeft =
    sidebarCollapsed ? (reserveTrafficLights ? "11rem" : "7rem") : undefined;

  // When header exists and the first tab is active, the content's top-left corner
  // must be sharp so it connects seamlessly with the active tab above it.
  // Exception: when sidebar is collapsed, always round top-left since there's no sidebar edge.
  const rightRounding = browserOpen ? "rounded-tr-none rounded-br-none" : "";
  const contentRounding = header
    ? firstTabActive && !sidebarCollapsed
      ? `rounded-xl rounded-tl-none ${rightRounding}`
      : `rounded-xl ${rightRounding}`
    : `rounded-xl ${rightRounding}`;

  return (
    <main
      className={`flex-1 overflow-hidden mx-1.25 my-1.25 flex flex-col`}
      style={{
        marginLeft,
        marginRight,
        // Content margins track the panels as they slide — same duration so the
        // two edges never drift apart mid-animation.
        transition: `margin ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
      }}
    >
      {header && (
        <div
          className={`shrink-0 ${hasRightPanel ? "max-w-[calc(100%-150px)]" : browserOpen ? "max-w-[calc(100%-150px)]" : ""}`}
          style={{
            paddingLeft: headerPaddingLeft,
            // On the same clock as the margin above, for the same reason: the
            // header's left edge is that margin *plus* this padding, and the
            // two move in opposite directions when the sidebar toggles. Give
            // them different durations and the tabs shoot past their resting
            // place, then drift back as the slower one catches up.
            transition: `padding ${LAYOUT_PANEL_ANIM_MS}ms ease-out, max-width ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
          }}
        >
          {header}
        </div>
      )}
      <div
        className={`flex-1 min-h-0 bg-primary dark:bg-primary-950 overflow-hidden ${contentRounding}`}
      >
        <div
          className="h-full overflow-auto"
          style={
            {
              "--content-inset-right": contentInsetRight ?? "0px",
            } as React.CSSProperties
          }
        >
          {children}
        </div>
      </div>
    </main>
  );
}
