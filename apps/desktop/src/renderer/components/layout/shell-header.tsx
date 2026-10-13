import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LAYOUT_PANEL_ANIM_MS, LAYOUT_TOGGLE_WIDTH_VAR } from "@/lib/layout";

interface ShellHeaderProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
  pending?: boolean;
  hidden?: boolean;
  paddingLeft?: string;
  reserveWindowControls?: boolean;
}

/**
 * One row owns the space shared by a tab group and its contextual actions.
 * Empty insets pass pointer hits through to the fixed window controls below.
 */
export function ShellHeader({ children, actions, pending, hidden, paddingLeft, reserveWindowControls, className, style, ...props }: ShellHeaderProps) {
  return (
    <div {...props} data-shell-header="" aria-hidden={hidden || undefined} aria-busy={pending || undefined}
      inert={hidden || pending}
      className={cn("pointer-events-none *:pointer-events-auto relative z-(--z-panel-toggle) flex h-(--shell-header-height) min-w-0 shrink-0 items-center gap-1 pr-2", className)}
      style={{
        visibility: hidden ? "hidden" : undefined,
        paddingLeft,
        paddingRight: reserveWindowControls ? `calc(var(${LAYOUT_TOGGLE_WIDTH_VAR}, 0px) + 0.5rem)` : undefined,
        transition: `padding ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
        ...style,
      }}>
      <div className="flex min-w-0 flex-1 items-end">{children}</div>
      <div data-shell-header-actions="" className="flex shrink-0 items-center gap-0.5 empty:hidden">{actions}</div>
    </div>
  );
}
