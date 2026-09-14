import type { ReactNode } from "react";
import { ArrowUp, Refresh } from "@/components/ui/icons";
import { Button, Text } from "@/components/ui";

/**
 * One row of the session panel. Every line in the panel — the change summary,
 * the branch, each git action, each subagent — is one of these, so the panel
 * reads as a single menu rather than a stack of differently-shaped widgets.
 *
 * Rows without `onClick` render as plain divs: a read-only row shouldn't be
 * focusable or offer a hover affordance it can't honour.
 */
export interface PanelItemProps {
  icon: ReactNode;
  label: ReactNode;
  /** Muted right-hand content: diff stats, a file count, a run state. */
  trailing?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Swaps the icon for a spinner (an in-flight commit, push, or refetch). */
  loading?: boolean;
  /** Adds the chevron that tracks `expanded`. */
  expandable?: boolean;
  expanded?: boolean;
  title?: string;
  /**
   * Makes the leading icon its own button, for a second action on the row (the
   * change summary expands on click but refreshes from its icon). The row then
   * renders as a div holding two buttons — a button inside a button is invalid.
   */
  onIconClick?: () => void;
  iconTitle?: string;
  /**
   * Action revealed over the trailing slot while the row is hovered — how a
   * change row offers Undo without spending width on a control that is idle
   * most of the time. Its own hit target: clicking it never runs `onClick`.
   */
  hoverAction?: {
    icon: ReactNode;
    onClick: () => void;
    /** Doubles as the accessible name — the button has no text. */
    title: string;
    /** Keeps the action visible and inert while it runs. */
    pending?: boolean;
    /**
     * Keeps it visible while it is the row's live affordance — the toggle for
     * a form it already opened has to stay reachable without hovering back.
     */
    pinned?: boolean;
  };
}

/**
 * Row metrics, split so the two-button variant can put the vertical padding on
 * its children (the icon and the label are separate hit targets) without the
 * outer row applying it a second time. Every row — top level or inside an
 * expanded section — shares them, so all icons line up in one column.
 * `PANEL_ROW_X` is exported for the form blocks that sit between rows.
 */
export const PANEL_ROW_X = "px-3";
const ROW_Y = "py-1.5";
const ROW_TEXT = "text-left text-s text-primary-700 dark:text-primary-300";
const ROW_BASE = `flex w-full items-center gap-2 ${PANEL_ROW_X} ${ROW_Y} ${ROW_TEXT}`;
const ROW_HOVER =
  "transition-colors hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-primary/5";

export function PanelItem({
  icon,
  label,
  trailing,
  onClick,
  disabled,
  loading,
  expandable,
  expanded,
  title,
  onIconClick,
  iconTitle,
  hoverAction,
}: PanelItemProps) {
  // A disabled row has to read as one dimmed strip. The single-button layout
  // gets that free from `disabled:opacity-40` on the row itself; the split
  // layout is several sibling elements, only one of which is the disabled
  // button — so the icon, trailing, and chevron take the same tone by hand,
  // instead of a bright icon sitting next to a greyed-out label.
  const dimmed = disabled && (onIconClick || hoverAction) ? "opacity-40" : "";
  const iconSlot = (
    <span className={`shrink-0 text-primary-600 dark:text-primary-400 ${dimmed}`}>
      {loading ? <Refresh className="size-4 animate-spin" /> : icon}
    </span>
  );
  // Size and colour come from the row (`ROW_TEXT`); the label only decides that
  // it is the emphasised half of the row.
  const labelSlot = (
    <Text
      as="span"
      size="inherit"
      tone="inherit"
      weight="medium"
      className="flex-1 truncate"
    >
      {label}
    </Text>
  );
  const trailingSlot = trailing ? (
    <Text
      as="span"
      size="xs"
      tone="subtle"
      className={`shrink-0 tabular-nums ${dimmed}`}
    >
      {trailing}
    </Text>
  ) : null;
  const chevronSlot = expandable ? (
    <ArrowUp
      className={`size-3 shrink-0 text-primary-400 transition-transform duration-200 ${dimmed} ${
        expanded ? "rotate-180" : "rotate-90"
      }`}
    />
  ) : null;
  const rest = (
    <>
      {labelSlot}
      {trailingSlot}
      {chevronSlot}
    </>
  );

  // Any second action on the row forces the split layout: the row becomes a div
  // of separate buttons, because a button inside a button is invalid HTML.
  if (onIconClick || hoverAction) {
    return (
      // The row still highlights as one strip; the zones just answer to
      // different clicks. Vertical padding lives on the buttons — putting it
      // here too would make this row taller than every other one.
      <div
        className={`group flex w-full items-center gap-2 ${PANEL_ROW_X} ${ROW_TEXT} ${ROW_HOVER}`}
      >
        {onIconClick ? (
          <Button
            onClick={onIconClick}
            title={iconTitle}
            aria-label={iconTitle}
            className={`${ROW_Y} hover:text-primary-900 dark:hover:text-primary-100`}
          >
            {iconSlot}
          </Button>
        ) : (
          <span className={ROW_Y}>{iconSlot}</span>
        )}
        <Button
          onClick={onClick}
          disabled={disabled}
          title={title}
          aria-expanded={expandable ? expanded : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2 ${ROW_Y} text-left disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {labelSlot}
        </Button>
        {hoverAction ? (
          // Stacked rather than swapped: the action sits over the trailing
          // content, so revealing it can't resize the row under the cursor.
          <span className={`relative flex shrink-0 items-center ${ROW_Y}`}>
            <Text
              as="span"
              size="xs"
              tone="subtle"
              className={`tabular-nums transition-opacity ${dimmed} ${
                hoverAction.pending || hoverAction.pinned
                  ? "opacity-0"
                  : "group-hover:opacity-0"
              }`}
            >
              {trailing}
            </Text>
            <Button
              onClick={hoverAction.onClick}
              disabled={hoverAction.pending}
              title={hoverAction.title}
              aria-label={hoverAction.title}
              className={`absolute inset-y-0 right-0 flex items-center rounded-md px-1 text-primary-600 transition-opacity hover:text-primary-900 focus-visible:opacity-100 dark:text-primary-400 dark:hover:text-primary-100 ${
                hoverAction.pending || hoverAction.pinned
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}
            >
              {hoverAction.pending ? (
                <Refresh className="size-3.5 animate-spin" />
              ) : (
                hoverAction.icon
              )}
            </Button>
          </span>
        ) : (
          trailingSlot
        )}
        {chevronSlot}
      </div>
    );
  }

  if (!onClick) {
    return (
      <div className={ROW_BASE} title={title}>
        {iconSlot}
        {rest}
      </div>
    );
  }

  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-expanded={expandable ? expanded : undefined}
      className={`${ROW_BASE} ${ROW_HOVER}`}
    >
      {iconSlot}
      {rest}
    </Button>
  );
}

/**
 * The area a `PanelItem` opens. Animates on grid-rows 0fr↔1fr so the panel
 * grows downward at whatever height the content needs, with no measurement.
 */
export function PanelCollapse({
  isOpen,
  children,
}: {
  isOpen: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="bg-primary-50 dark:bg-primary/5">{children}</div>
      </div>
    </div>
  );
}
