import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useMainHeader } from "@/hooks/use-main-header";
import { useCapabilities } from "@/lib/platform";
import { LAYOUT_PANEL_ANIM_MS } from "@/lib/layout";

interface MainContentProps {
  children: ReactNode;
  marginLeft: string;
  marginRight: string;
  transparentSurface?: boolean;
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
  /** Preserve header space while an expanded panel owns the workspace. */
  headerHidden?: boolean;
  /** Expanded Work/Chat browsers share this row without owning its title. */
  browserTabsInHeader?: boolean;
}

export function getCollapsedHeaderPaddingLeft(
  sidebarCollapsed: boolean | undefined,
  windowChrome: boolean,
  isFullscreen: boolean,
): string | undefined {
  if (!sidebarCollapsed) return undefined;

  // Only the sidebar toggle remains in the titlebar. Native chrome also needs
  // room for the macOS traffic lights to its left.
  return windowChrome && !isFullscreen ? "4.5rem" : "3rem";
}

export function MainContent({
  children,
  marginLeft,
  marginRight,
  transparentSurface,
  contentInsetRight,
  hasRightPanel,
  sidebarCollapsed,
  browserOpen,
  headerHidden,
  browserTabsInHeader,
}: MainContentProps) {
  const { header, firstTabActive, pending, setBrowserTabsHost } = useMainHeader();
  const { windowChrome } = useCapabilities();
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    return window.api.app.onFullscreenChange(setIsFullscreen);
  }, []);

  const headerPaddingLeft = getCollapsedHeaderPaddingLeft(
    sidebarCollapsed,
    windowChrome,
    isFullscreen,
  );

  // When header exists and the first tab is active, the content's top-left corner
  // must be sharp so it connects seamlessly with the active tab above it.
  // Exception: when sidebar is collapsed, always round top-left since there's no sidebar edge.
  const contentRounding = header && firstTabActive && !sidebarCollapsed
    ? "rounded-2xl rounded-tl-none"
    : "rounded-2xl";

  return (
    // Tabs extend one corner radius over the sidebar; the content surface
    // keeps its own overflow clipped below the header.
    <main
      className={`flex-1 min-w-0 ${header || browserTabsInHeader ? "overflow-visible" : "overflow-hidden"} mx-1.25 my-1.25 flex flex-col`}
      style={{
        marginLeft,
        marginRight,
        // Expanded workspace surfaces inherit the same gap as the tab strip.
        "--shell-header-inset-left": headerPaddingLeft ?? "0px",
        // Content margins track the panels as they slide — same duration so the
        // two edges never drift apart mid-animation.
        transition: `margin ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
      } as CSSProperties}
    >
      {(header || browserTabsInHeader) && (
        <div
          className={`shrink-0 ${browserTabsInHeader ? "flex h-(--shell-header-height) min-w-0 items-center" : hasRightPanel || browserOpen ? "max-w-[calc(100%-150px)]" : ""}`}
          aria-hidden={headerHidden || undefined}
          aria-busy={pending || undefined}
          inert={headerHidden || pending}
          style={{
            // The browser's edge and the workspace margins move on separate
            // clocks. Hide the covered tabs directly so no gap can expose them.
            visibility: headerHidden ? "hidden" : undefined,
            paddingLeft: headerPaddingLeft,
            // On the same clock as the margin above, for the same reason: the
            // header's left edge is that margin *plus* this padding, and the
            // two move in opposite directions when the sidebar toggles. Give
            // them different durations and the tabs shoot past their resting
            // place, then drift back as the slower one catches up.
            transition: `padding ${LAYOUT_PANEL_ANIM_MS}ms ease-out, max-width ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
          }}
        >
          {browserTabsInHeader ? (
            <>
              {header && (
                <div className="flex min-w-0 max-w-[40%] items-end">
                  {header}
                </div>
              )}
              <div ref={setBrowserTabsHost} className="min-w-0 flex-1" data-browser-tabs-host="" />
            </>
          ) : header}
        </div>
      )}
      {!header && !browserTabsInHeader && (
        <div className="hidden h-(--shell-header-height) shrink-0 md:block" aria-hidden="true" />
      )}
      <div
        data-main-content-surface=""
        className={`flex-1 min-h-0 overflow-hidden ${contentRounding} ${transparentSurface ? "bg-transparent" : "bg-primary dark:bg-primary-950"}`}
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
