import { type CSSProperties, type ReactNode } from "react";
import { useMainHeader } from "@/hooks/use-main-header";
import { useShellHeaderChrome } from "@/hooks/use-shell-header-chrome";
import { LAYOUT_PANEL_ANIM_MS } from "@/lib/layout";
import { ShellHeader } from "../shell-header";

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
  sidebarCollapsed?: boolean;
  headerActions?: ReactNode;
  reserveWindowControls?: boolean;
  /** Preserve header space while an expanded panel owns the workspace. */
  headerHidden?: boolean;
  /** Expanded Work/Chat browsers share this row without owning its title. */
  browserTabsInHeader?: boolean;
}

export { getCollapsedHeaderPaddingLeft } from "@/hooks/use-shell-header-chrome";

export function MainContent({
  children,
  marginLeft,
  marginRight,
  transparentSurface,
  contentInsetRight,
  sidebarCollapsed,
  headerActions,
  reserveWindowControls,
  headerHidden,
  browserTabsInHeader,
}: MainContentProps) {
  const { header, firstTabActive, pending, setBrowserTabsHost } = useMainHeader();
  const { mainInsetLeft: headerPaddingLeft } = useShellHeaderChrome(sidebarCollapsed);

  // When header exists and the first tab is active, the content's top-left corner
  // must be sharp so it connects seamlessly with the active tab above it.
  // Exception: when sidebar is collapsed, always round top-left since there's no sidebar edge.
  const contentRounding = header && firstTabActive && !sidebarCollapsed
    ? "rounded-2xl rounded-tl-none"
    : "rounded-2xl";

  return (
    // Clip the tab corner gutter at the main area's edge as tabs scroll.
    // The collapsed-sidebar inset still leaves room for the leading curve.
    <main
      className="flex-1 min-w-0 overflow-hidden mx-1.25 my-1.25 flex flex-col"
      style={{
        marginLeft,
        marginRight,
        // Expanded workspace surfaces inherit the same gap as the tab strip.
        "--shell-header-inset-left": headerPaddingLeft ?? "0px",
        "--tab-leading-corner-opacity": sidebarCollapsed ? 1 : 0,
        // Content margins track the panels as they slide — same duration so the
        // two edges never drift apart mid-animation.
        transition: `margin ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
      } as CSSProperties}
    >
      {(header || browserTabsInHeader || headerActions) && (
        <ShellHeader hidden={headerHidden} pending={pending} paddingLeft={headerPaddingLeft}
          reserveWindowControls={reserveWindowControls} actions={headerActions}>
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
        </ShellHeader>
      )}
      {!header && !browserTabsInHeader && !headerActions && (
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
