import type { ReactNode } from "react";
import {
  ArrowUp,
  Asterisk,
  Attach,
  BoltFill,
  ChevronUp,
  ProjectFolder,
  WorkspaceStatusIcon,
} from "@/components/ui/icons";
import { PanelItem } from "@/features/workspace/components/session-panel/panel-item";
import { getWorkspaceStatusConfig } from "@/lib/workspace-status";
import type { WorkspaceStatus } from "@/lib/redux/api/workspaceApi";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────
// Decorative mini-UI mockups that sit behind each core-feature card.
//
// These are pictures, not widgets: no data, no state, no interaction. They
// are built from the same surface/text tokens as the real app so they read
// as "a glimpse of Mains" in both themes without shipping screenshots.
// Every preview is `aria-hidden` — the card's title and blurb carry meaning.
// ─────────────────────────────────────────────────────────────

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

const FRAME =
  "w-[340px] rounded-2xl bg-primary-50/80 p-3 text-[11px] leading-none text-primary-700 dark:bg-primary-900/60 dark:text-primary-300";
const ROW = "flex items-center gap-2 rounded-lg px-2 py-1.5";
const GLYPH = "size-3.5 shrink-0 rounded bg-primary-300/60 dark:bg-primary-700/60";
const PILL =
  "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] text-primary-500 dark:text-primary-400 bg-primary-200/60 dark:bg-primary-800/60";

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div aria-hidden className={cn(FRAME, className)}>
      {children}
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-1 pb-1 text-[9px] uppercase tracking-wide text-primary-400 dark:text-primary-500">
      {children}
    </div>
  );
}

export interface ListPreviewRow {
  label: string;
  meta?: string;
  Icon?: IconComponent;
  iconClassName?: string;
}

/** Heading + rows: issues, schedules. */
export function ListPreview({
  heading,
  rows,
}: {
  heading?: string;
  rows: ListPreviewRow[];
}) {
  return (
    <Frame>
      {heading && <Heading>{heading}</Heading>}
      {rows.map((row) => (
        <div key={row.label} className={ROW}>
          {row.Icon ? (
            <row.Icon className={cn("size-3.5 shrink-0", row.iconClassName)} />
          ) : (
            <span className={GLYPH} />
          )}
          <span className="truncate">{row.label}</span>
          {row.meta && <span className={PILL}>{row.meta}</span>}
        </div>
      ))}
    </Frame>
  );
}

export interface WorkspaceListRow {
  name: string;
  branch: string;
  status: WorkspaceStatus;
  insertions?: number;
  deletions?: number;
  active?: boolean;
}

/**
 * The sidebar's workspace list. Mirrors `layout/sidebar/workspace-item.tsx`:
 * project icon + name on the first line, status glyph + branch on the second,
 * diff stats on the right, and the active row wearing the glass outline. Rows
 * only — a search field would just repeat the one in ListPreview.
 */
export function WorkspaceListPreview({ rows }: { rows: WorkspaceListRow[] }) {
  return (
    <Frame className="w-64 origin-top scale-90 space-y-1.5 p-2">
      {rows.map((row) => {
        const status = getWorkspaceStatusConfig(row.status);
        return (
          <div
            key={row.name}
            className={cn(
              "relative rounded-xl px-2.5 py-1.5",
              row.active && "bg-primary/50 glass-outline dark:bg-primary/5",
            )}
          >
            <div className="mb-0.5 flex items-center gap-1">
              <ProjectFolder className="size-3.5 shrink-0 text-primary-800 dark:text-primary-200" />
              <span className="truncate text-[11px] text-primary-900 dark:text-primary-50">
                {row.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <WorkspaceStatusIcon
                status={row.status}
                className={cn("ml-0.5 size-2.75 shrink-0", status.iconColor)}
              />
              <span className="truncate text-[10px] text-primary-500 dark:text-primary-400">
                {row.branch}
              </span>
            </div>
            {(row.insertions != null || row.deletions != null) && (
              <span className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 font-mono text-[9px] tabular-nums">
                {row.insertions != null && (
                  <span className="text-success">+{row.insertions}</span>
                )}
                {row.deletions != null && (
                  <span className="text-danger">-{row.deletions}</span>
                )}
              </span>
            )}
          </div>
        );
      })}
    </Frame>
  );
}

/**
 * Chip classes lifted from `rich-input-form.tsx`'s `buildChip` — that file
 * builds chips as raw DOM, so there is no component to share; keeping the
 * class string identical is how this picture stays honest.
 */
const CHIP =
  "inline-flex h-6 items-center gap-1 rounded-lg bg-primary px-1.5 align-middle text-xs leading-none font-medium select-none dark:bg-primary-300/10 dark:text-primary-200";

/** The composer, with context attached: what `@`, `/` and `$` leave behind. */
export function ComposerPreview({
  text,
  chips,
  model,
  effort,
}: {
  text: string;
  chips: { label: string; Icon?: IconComponent; iconClassName?: string }[];
  model: string;
  effort: string;
}) {
  return (
    <div
      aria-hidden
      className="w-72 origin-top scale-90 rounded-[28px] bg-primary-50/80 px-3 pt-3 pb-2 select-none dark:bg-primary-900/60"
    >
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-1 pb-4 text-xs text-primary-800 dark:text-primary-200">
        <span>{text}</span>
        {chips.map((chip) => (
          <span key={chip.label} className={CHIP}>
            <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
              {chip.Icon ? (
                <chip.Icon className={cn("size-3.5", chip.iconClassName)} />
              ) : (
                <span className="size-2.5 rounded-sm bg-primary-400/70" />
              )}
            </span>
            {chip.label}
          </span>
        ))}
      </div>

      {/* Toolbar: attach · model + effort · fast · send — the order
          `input-toolbar.tsx` lays them out in. */}
      <div className="flex items-center gap-1.5 text-primary-700 dark:text-primary-300">
        <Attach className="size-4 shrink-0" />
        <span className="flex items-center gap-1.5 px-1 text-xs text-primary-950 dark:text-primary">
          <Asterisk className="size-3.5 shrink-0 text-claude" />
          {model}
          <span className="text-primary-600 dark:text-primary-400">{effort}</span>
          <ArrowUp className="size-3 shrink-0 rotate-180" />
        </span>
        <BoltFill className="size-3.5 shrink-0" />
        <span className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-full glass-button">
          <ChevronUp className="size-4 text-primary-800 dark:text-primary" />
        </span>
      </div>
    </div>
  );
}

export interface ModesPreviewItem {
  label: string;
  Icon: IconComponent;
  iconClassName?: string;
  shortcut: string;
}

/**
 * The titlebar mode picker, drawn open: the pill trigger with the menu below
 * it. Mirrors `space-mode-picker.tsx` — same pill, same icon + label +
 * shortcut row — as a still picture.
 */
export function ModesPreview({
  items,
  active,
}: {
  items: ModesPreviewItem[];
  active: string;
}) {
  return (
    <div aria-hidden className="w-47.5 select-none">
      <span className="flex h-7 w-fit items-center rounded-2xl px-3 text-[11px] font-medium text-primary-900 glass-outline dark:text-primary-100">
        {active}
      </span>
      <div className="mt-1.5 overflow-hidden rounded-xl bg-primary-50/85 py-1 shadow-lg dark:bg-primary-900/80">
        {items.map((item) => (
          <div
            key={item.label}
            className={cn(
              "flex items-center gap-2 px-4 py-2",
              item.label === active && "bg-primary-200/50 dark:bg-primary-800/60",
            )}
          >
            <item.Icon className={cn("size-3.5 shrink-0", item.iconClassName)} />
            <span className="flex-1 text-[11px] text-primary-800 dark:text-primary-200">
              {item.label}
            </span>
            <span className="text-[10px] text-primary-500 dark:text-primary-400">
              {item.shortcut}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SessionPanelRow {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  expandable?: boolean;
}

/**
 * The session box, drawn shut. Rows come from the real `PanelItem`, so the
 * picture inherits the panel's row metrics and icon column instead of
 * re-deriving them — pass no `onClick` and each row renders as a plain div.
 * It shrinks by scaling for the same reason: restyling the type would mean a
 * second set of panel metrics to keep in step.
 */
export function SessionPanelPreview({ rows }: { rows: SessionPanelRow[] }) {
  return (
    <div
      aria-hidden
      className="w-60 origin-top scale-90 overflow-hidden rounded-2xl bg-primary glass-outline dark:bg-primary-950"
    >
      {rows.map((row) => (
        <PanelItem
          key={row.label}
          icon={row.icon}
          label={row.label}
          trailing={row.trailing}
          expandable={row.expandable}
        />
      ))}
    </div>
  );
}

/**
 * A row of app-style tiles: the four agents side by side. Unlike the other
 * previews this one wears no frame — the tiles themselves are the picture, so
 * a panel behind them would just read as a second card.
 */
export function TilesPreview({
  tiles,
}: {
  tiles: { label: string; Icon: IconComponent; iconClassName?: string }[];
}) {
  return (
    <div aria-hidden className="flex items-center justify-center gap-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex flex-col items-center gap-1.5">
          <span className="flex size-12 items-center justify-center rounded-2xl glass-outline">
            <tile.Icon className={cn("size-6", tile.iconClassName)} />
          </span>
          <span className="text-[9px] text-primary-500 dark:text-primary-400">
            {tile.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Rounded device shell — the bezel both silhouettes share. */
function DeviceFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[20px] glass-outline bg-primary-50/95",
        "dark:border-primary-700 dark:bg-primary-900/90",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Signal/battery blobs + a clock: what makes a rectangle read as a screen. */
function StatusBar({ time }: { time: string }) {
  return (
    <div className="flex items-center justify-between px-2 pt-1.5 pb-1 text-[7px] font-medium text-primary-600 dark:text-primary-400">
      <span>{time}</span>
      <span className="flex items-center gap-0.5">
        <span className="size-1 rounded-full bg-primary-400/80" />
        <span className="size-1 rounded-full bg-primary-400/80" />
        <span className="h-1.5 w-2.5 rounded-xs border border-primary-400/80" />
      </span>
    </div>
  );
}

/**
 * Follows the app's own asymmetry: what you sent wears a grey bubble, what the
 * agent answered is plain text on the surface.
 */
function Bubble({ mine, text }: { mine?: boolean; text: string }) {
  return (
    <div
      className={cn(
        "max-w-[88%] text-[6px] leading-tight",
        mine
          ? "ml-auto rounded-md bg-primary-300/70 px-1.5 py-1 text-primary-900 dark:bg-primary-700/20 dark:text-primary-100"
          : "px-0.5 py-0.5 text-primary-700 dark:text-primary-300",
      )}
    >
      {text}
    </div>
  );
}

/** The composer, reduced to its silhouette: a pill and a send disc. */
function ComposerBar() {
  return (
    <div className="mt-auto flex items-center gap-1 px-1.5 pb-1.5">
      <span className="h-4 flex-1 rounded-lg bg-primary-200/70 dark:bg-primary-800/70" />
      <span className="size-4 shrink-0 rounded-full bg-primary-300/70 dark:bg-primary-700/70" />
    </div>
  );
}

/**
 * A phone and a tablet running the same session — the remote-backend picture.
 * Both carry a status bar and a composer so they read as running apps rather
 * than empty slabs, and the tablet adds the sidebar column the phone drops.
 */
export function DevicesPreview({
  lines,
}: {
  lines: { mine?: boolean; text: string }[];
}) {
  return (
    <div aria-hidden className="flex items-end gap-3 select-none">
      <DeviceFrame className="flex h-38 w-24 flex-col">
        <StatusBar time="9:41" />
        <span className="mx-auto mb-1 h-1 w-6 rounded-full bg-primary-800/70 dark:bg-primary-900" />
        <div className="flex-1 space-y-1 overflow-hidden px-1.5">
          {lines.map((line, i) => (
            <Bubble key={i} mine={line.mine} text={line.text} />
          ))}
        </div>
        <ComposerBar />
      </DeviceFrame>

      <DeviceFrame className="flex h-31 w-42 flex-col rounded-2xl">
        <StatusBar time="9:41" />
        <div className="flex min-h-0 flex-1">
          {/* Sidebar: the column a tablet has room for and a phone does not */}
          <div className="w-12 shrink-0 space-y-1 border-r border-primary-300/50 px-1.5 py-1 dark:border-primary-700/60">
            <span className="block h-1.5 w-full rounded bg-primary-300/70 dark:bg-primary-700/20" />
            <span className="block h-1.5 w-4/5 rounded bg-primary-200/70 dark:bg-primary-800/20" />
            <span className="block h-1.5 w-3/5 rounded bg-primary-200/70 dark:bg-primary-800/20" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 space-y-1 overflow-hidden px-1.5 py-1">
              {lines.slice(0, 2).map((line, i) => (
                <Bubble key={i} mine={line.mine} text={line.text} />
              ))}
            </div>
            <ComposerBar />
          </div>
        </div>
      </DeviceFrame>
    </div>
  );
}
