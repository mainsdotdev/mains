import type { MouseEvent, ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setWorkspaceGroupExpanded } from "@/lib/redux/slices/appSettingsSlice";
import { Button, Text, type SortableHandle } from "@/components/ui";
import { ArrowUp, New } from "@/components/ui/icons";

/** Shared by the header's own glyph and any a caller supplies in its place. */
export const SIDEBAR_ACTION_ICON =
  "w-3 h-3 text-primary-800 dark:text-primary-200 hover:text-primary-900 dark:hover:text-primary-100";

/**
 * A collapsible sidebar section: header row (label, count, hover "+" action)
 * over an animated children well. Extracted from the workspace list so the
 * chat list's "Projects" tree can share it — it is agnostic about what the
 * children are. Expand state persists per `groupKey` in appSettings.
 */
export function SidebarGroupSection({
  groupKey,
  label,
  labelTint,
  icon,
  // count,
  action,
  secondaryAction,
  sortHandle,
  children,
}: {
  groupKey: string;
  label: string;
  /**
   * Text colour class for the label. Two callers want one: a section whose
   * icon carries a user tint the title should share, so the pair reads as one
   * mark rather than a coloured glyph beside unrelated white text; and a
   * section that names a shelf rather than a thing, which wants a quieter
   * title than the default. Absent or empty keeps the `contrast` tone.
   */
  labelTint?: string;
  /** A function form gets the open state, so the glyph can track the accordion. */
  icon?: ReactNode | ((expanded: boolean) => ReactNode);
  count: number;
  /**
   * Hover-revealed action on the header. The glyph names what the click makes:
   * a plus for one more of what the section already lists (another worktree
   * under a project), the New mark for starting something fresh (a chat).
   * Defaults to New.
   */
  action?: { label: string; onClick: () => void; icon?: ReactNode };
  /**
   * Optional sibling action rendered before the primary "+" action. Its click
   * carries the event so a caller can anchor a menu to the button it came from.
   */
  secondaryAction?: {
    label: string;
    onClick: (event: MouseEvent<HTMLElement>) => void;
    icon: ReactNode;
  };
  /**
   * Makes the header the handle of a `SortableItem`: dragging it, or Alt+Arrow
   * while it has focus, moves the whole section.
   */
  sortHandle?: SortableHandle;
  children: ReactNode;
}) {
  const dispatch = useAppDispatch();
  // Absent means expanded — a group the user has never touched starts open.
  const expanded = useAppSelector(
    (state) => state.appSettings.workspaceGroupExpanded[groupKey] ?? true,
  );
  const toggleExpanded = () => {
    dispatch(setWorkspaceGroupExpanded({ groupKey, expanded: !expanded }));
  };
  const isSortable = !!sortHandle?.listeners;

  return (
    <div className="">
      <div
        ref={sortHandle?.ref}
        role="button"
        tabIndex={0}
        onPointerDown={(event) => {
          // A press on one of the header's own buttons is a click on that
          // button, never the start of a drag.
          if ((event.target as HTMLElement).closest("button")) return;
          sortHandle?.listeners?.onPointerDown?.(event);
        }}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          sortHandle?.onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpanded();
          }
        }}
        className={`group/section w-full flex items-center gap-1.5 px-2 py-1 mb-px rounded-lg hover:bg-primary/50 dark:hover:bg-primary/5 transition-colors ${
          isSortable
            ? "cursor-grab active:cursor-grabbing"
            : "cursor-pointer"
        }`}
      >
        {icon && (
          <span className="shrink-0 text-xs">
            {typeof icon === "function" ? icon(expanded) : icon}
          </span>
        )}
        <Text
          as="span"
          size="s"
          tone={labelTint ? "inherit" : "contrast"}
          className={`truncate ${labelTint ?? ""}`}
          weight="normal"
        >
          {label}
        </Text>
        <div className="ml-auto flex items-center gap-1.5">
          {/* <Text
            as="span"
            size="xxs"
            tone="secondary"
            className="tabular-nums group-hover/section:hidden"
          >
            {count}
          </Text> */}
          {action && (
            <>
              {secondaryAction && (
                <Button
                  tooltip={secondaryAction.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    secondaryAction.onClick(e);
                  }}
                  className="hidden group-hover/section:flex items-center p-0.5 cursor-pointer rounded-md"
                  aria-label={secondaryAction.label}
                >
                  {secondaryAction.icon}
                </Button>
              )}
              <Button
                tooltip={action.label}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick();
                }}
                className="hidden group-hover/section:flex items-center p-0.5 cursor-pointer rounded-md"
                aria-label={action.label}
              >
                {action.icon ?? <New className={SIDEBAR_ACTION_ICON} />}
              </Button>
            </>
          )}
          <ArrowUp
            className={`w-3 h-3 -mr-1 text-primary-800 dark:text-primary-200 transition-transform duration-200 hidden group-hover/section:block ${
              expanded ? "rotate-180" : "rotate-90"
            }`}
          />
        </div>
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
