import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface PageShellProps {
  children: ReactNode;
  /**
   * Add bottom padding (`pb-16`) on top of the default `pt-16`. Use for simple
   * pages where content ends without its own bottom spacing (Pulse, Relay).
   * Pages whose content includes its own bottom padding (Settings, Plugins)
   * leave this off.
   */
  bottomPadded?: boolean;
  className?: string;
}

/**
 * Top-level shell for full-page routes — centred 240ch column with a scrollable
 * body. Use this for any top-level page (Settings, Plugins, Pulse, Relay, …)
 * so the centred-column width and scroll behaviour stay consistent.
 */
export function PageShell({
  children,
  bottomPadded = false,
  className = "",
}: PageShellProps) {
  return (
    <div
      className={cn(
        "h-full max-w-240 mx-auto px-2 overflow-y-auto noscrollbar bg-primary dark:bg-primary-950",
        bottomPadded ? "py-16" : "pt-16",
        className,
      )}
    >
      {children}
    </div>
  );
}
