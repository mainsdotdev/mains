import { Children, Fragment, type CSSProperties, type ReactNode } from "react";
import {
  ArrowUp,
  Asterisk,
  Attach,
  BoltFill,
  Check,
  ChevronUp,
  ProjectFolder,
  Sparkles,
  WorkspaceStatusIcon,
} from "@/components/ui/icons";
import { PanelItem } from "@/features/workspace/components/session-panel/panel-item";
import { ShinePlaceholder } from "@/features/workspace/components/session-panel/git-actions/controls";
import { getWorkspaceStatusConfig } from "@/lib/workspace-status";
import { MODE_CONFIGS } from "@/lib/mode-config";
import type { ModeId } from "@mains/contracts/modes";
import type { WorkspaceStatus } from "@/lib/redux/api/workspaceApi";
import { cn } from "@/lib/cn";
import { AsciiSpinner, Text } from "@/components/ui";

// ─────────────────────────────────────────────────────────────
// Decorative mini-UI mockups that sit behind each core-feature card.
//
// These are pictures, not widgets: no data, no state, no interaction. They
// are built from the same surface/text tokens as the real app so they read
// as "a glimpse of Mains" in both themes without shipping screenshots.
// Every preview is `aria-hidden` — the card's title and blurb carry meaning.
//
// Motion is CSS alone (`preview-*` in index.css): each loop rests on its first
// frame and only plays while its card is hovered. Base classes always draw
// that rest frame too, so with reduced motion (no animation at all) a preview
// is still exactly the picture described here.
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

/**
 * One step of a `preview-cycle-N` / `preview-ticker-3` loop, on the axis the
 * items run along. Custom properties aren't in `CSSProperties`; this is the
 * one cast for them.
 */
function stepStyle(axis: "x" | "y", step: string): CSSProperties {
  return { [`--preview-${axis}`]: step } as CSSProperties;
}

/**
 * Delay that places member `index` of an `count`-member set (`preview-spot-4`,
 * `preview-swap-3`) at its own slot of a `duration`-second loop. Negative, so
 * it moves the member mid-cycle without holding it on the 0% frame first.
 */
function slotDelay(index: number, count: number, duration: number, extra = 0) {
  return `${-(((count - index) % count) * duration) / count + extra}s`;
}

/**
 * Rows stacked in one grid column with a selection drawn behind them. The
 * selection shares the first row's grid cell, so it takes that row's height
 * without measuring anything, and `preview-cycle-N` steps it one row plus the
 * gap at a time. Rows must be equal height — every list here is. Loops exist
 * for 3, 4 and 5 rows; any other count keeps the selection on the first row.
 */
function CyclingRows({
  children,
  selectionClassName,
  gap = "0px",
}: {
  children: ReactNode;
  selectionClassName: string;
  gap?: string;
}) {
  const rows = Children.toArray(children);
  return (
    <div className="grid" style={{ rowGap: gap }}>
      <span
        className={cn(
          "preview-motion col-start-1 row-start-1",
          `preview-cycle-${rows.length}`,
          selectionClassName,
        )}
        style={stepStyle("y", `calc(100% + ${gap})`)}
      />
      {/* Positioned so they paint over the selection: a transformed element
          is lifted above in-flow siblings otherwise. */}
      {rows.map((row, i) => (
        <div key={i} className="relative col-start-1 min-w-0" style={{ gridRowStart: i + 1 }}>
          {row}
        </div>
      ))}
    </div>
  );
}

/**
 * Three rows rolling down one at a time, as if new ones kept arriving. A copy
 * of the rows waits above the visible set; the loop's last step lands on it,
 * which looks the same as the first frame, so the restart doesn't show.
 */
function TickerRows({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden">
      <div className="preview-motion preview-ticker-3 relative" style={stepStyle("y", "33.3333%")}>
        <div className="absolute inset-x-0 bottom-full">{children}</div>
        {children}
      </div>
    </div>
  );
}

export interface ListPreviewRow {
  label: string;
  meta?: string;
  Icon?: IconComponent;
  iconClassName?: string;
}

/**
 * Heading + rows: issues, schedules. On hover a `select` list walks a
 * selection down its rows; a `ticker` list (three rows) rolls new rows in
 * from the top.
 */
export function ListPreview({
  heading,
  rows,
  motion = "select",
}: {
  heading?: string;
  rows: ListPreviewRow[];
  motion?: "select" | "ticker";
}) {
  const items = rows.map((row) => (
    <div key={row.label} className={ROW}>
      {row.Icon ? (
        <row.Icon className={cn("size-3.5 shrink-0", row.iconClassName)} />
      ) : (
        <span className={GLYPH} />
      )}
      <span className="truncate">{row.label}</span>
      {row.meta && <span className={PILL}>{row.meta}</span>}
    </div>
  ));
  return (
    <Frame>
      {heading && <Heading>{heading}</Heading>}
      {motion === "ticker" ? (
        <TickerRows>{items}</TickerRows>
      ) : (
        <CyclingRows selectionClassName="rounded-lg bg-primary-200/50 dark:bg-primary-800/40">
          {items}
        </CyclingRows>
      )}
    </Frame>
  );
}

export interface WorkspaceListRow {
  name: string;
  branch: string;
  status: WorkspaceStatus;
  insertions?: number;
  deletions?: number;
}

/**
 * The sidebar's workspace list. Mirrors `layout/sidebar/workspace-item.tsx`:
 * project icon + name on the first line, status glyph + branch on the second,
 * diff stats on the right, and the active row wearing the glass outline — the
 * first row at rest, moving down the list on hover. Rows only — a search field
 * would just repeat the one in ListPreview.
 */
export function WorkspaceListPreview({ rows }: { rows: WorkspaceListRow[] }) {
  return (
    <Frame className="w-64 origin-top scale-90 p-2">
      <CyclingRows
        gap="0.375rem"
        selectionClassName="rounded-xl bg-primary/50 glass-outline dark:bg-primary/5"
      >
        {rows.map((row) => {
          const status = getWorkspaceStatusConfig(row.status);
          return (
            <div key={row.name} className="relative rounded-xl px-2.5 py-1.5">
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
      </CyclingRows>
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

export interface ComposerChip {
  label: string;
  Icon?: IconComponent;
  iconClassName?: string;
}

/** Length of one `preview-swap-3` loop, in seconds — keep in step with index.css. */
const SWAP_DURATION = 6;

function ChipBody({ chip }: { chip: ComposerChip }) {
  return (
    <>
      <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
        {chip.Icon ? (
          <chip.Icon className={cn("size-3.5", chip.iconClassName)} />
        ) : (
          <span className="size-2.5 rounded-sm bg-primary-400/70" />
        )}
      </span>
      {chip.label}
    </>
  );
}

/**
 * The composer, with context attached: what `@`, `/` and `$` leave behind.
 * Each entry of `slots` is one chip position holding up to three plugins; on
 * hover they take turns in it, the slots a beat apart, so the prompt keeps
 * picking up something new. The slot is as wide as its widest plugin, so the
 * prompt around it never reflows.
 */
export function ComposerPreview({
  text,
  slots,
  model,
  effort,
}: {
  text: string;
  slots: ComposerChip[][];
  model: string;
  effort: string;
}) {
  return (
    <div
      aria-hidden
      className="w-88 scale-90 rounded-[28px] bg-primary-50/80 px-3 pt-3 pb-2 select-none dark:bg-primary-900/60"
    >
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-1 pb-4 text-xs text-primary-800 dark:text-primary-200">
        <span>{text}</span>
        {slots.map((alternatives, slot) => (
          <span key={slot} className="inline-grid justify-items-start align-middle">
            {alternatives.map((chip, k) => (
              <span
                key={chip.label}
                className={cn(
                  CHIP,
                  "col-start-1 row-start-1",
                  alternatives.length === 3 && "preview-motion preview-swap-3",
                  // The rest frame shows the first plugin only.
                  k > 0 && "opacity-0",
                )}
                style={{
                  animationDelay: slotDelay(k, 3, SWAP_DURATION, slot * 0.35),
                }}
              >
                <ChipBody chip={chip} />
              </span>
            ))}
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
  mode: ModeId;
  shortcut: string;
}

/**
 * The sidebar mode picker, drawn open: the `Mains <mode>` trigger with the
 * menu below it. Mirrors `space-mode-picker.tsx`'s `sidebar` appearance —
 * same trigger, same label + description + shortcut row, same surfaces — as a
 * still picture. Labels and descriptions come from `MODE_CONFIGS`, so the
 * copy can't drift from the real menu. The real menu is a `DropdownMenuItem`
 * per row, which is always a button; the rows here repeat its classes instead.
 *
 * The first item is the one selected at rest. On hover the selection steps
 * through the menu and the trigger's label rolls along with it — both run the
 * same loop, so they stay in step.
 */
export function ModesPreview({
  prefixLabel,
  items,
}: {
  prefixLabel: string;
  items: ModesPreviewItem[];
}) {
  return (
    <div aria-hidden className="w-65 origin-top scale-90 select-none">
      <span className="flex h-8 w-fit items-center gap-1.5 rounded-xl bg-primary/80 px-2 text-base font-medium text-primary-800 dark:bg-primary/5 dark:text-primary-200">
        <span className="shrink-0 font-semibold tracking-tight">{prefixLabel}</span>
        <span className="h-lh overflow-hidden font-normal tracking-tight">
          <span
            className={cn("preview-motion flex flex-col", `preview-cycle-${items.length}`)}
            style={stepStyle("y", `${-100 / items.length}%`)}
          >
            {items.map((item) => (
              <span key={item.mode}>{MODE_CONFIGS[item.mode].label}</span>
            ))}
          </span>
        </span>
        <ArrowUp className="size-3.5 shrink-0 rotate-180 text-primary-500 dark:text-primary-400" />
      </span>
      <div className="mt-1.5 overflow-hidden rounded-2xl p-1.5 glass-input">
        <CyclingRows gap="0.125rem" selectionClassName="rounded-xl bg-primary-200/40 dark:bg-primary/5">
          {items.map((item) => (
            <div key={item.mode} className="flex items-center gap-4 rounded-xl px-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block text-s font-medium text-primary-950 dark:text-primary-50">
                  {MODE_CONFIGS[item.mode].label}
                </span>
                <span className="mt-0.5 block truncate text-xs text-primary-500 dark:text-primary-400">
                  {MODE_CONFIGS[item.mode].description}
                </span>
              </span>
              <span className="shrink-0 text-xs text-primary-500 dark:text-primary-400">
                {item.shortcut}
              </span>
            </div>
          ))}
        </CyclingRows>
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
 * What the picture does on hover: pick `row`, open its form showing
 * `placeholder`, press Generate (the field shimmers `generating`), type
 * `message`, press `confirm`, close, and swap the first row's trailing for
 * `done`. Copy the real form's strings so the picture says what the app says.
 */
export interface SessionPanelAction {
  row: number;
  placeholder: string;
  generating: string;
  message: string;
  confirm: { icon: ReactNode; label: string };
  done: ReactNode;
}

/** A pressed / picked row: the fill sits behind, the row paints over it. */
function RowWithFill({
  fillClassName,
  children,
}: {
  fillClassName: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span className={cn("preview-motion absolute inset-0 rounded-lg opacity-0", fillClassName)} />
      <div className="relative">{children}</div>
    </div>
  );
}

/**
 * The Generate pill tucked into the message box. `GenerateButton`
 * (`git-actions/controls.tsx`) is a real button, so its classes are repeated
 * here; both of its states are drawn stacked in one cell — the idle label and
 * the generating spinner — and the story fades between them. The cell is as
 * wide as the wider state, so the pill doesn't jump as it swaps.
 */
function GeneratePill() {
  return (
    <span className="absolute right-2 bottom-3 grid justify-items-end rounded-lg bg-primary-100/60 px-2 py-1 text-xs text-primary-600 glass-primary dark:bg-primary-800/40 dark:text-primary-400">
      <span className="preview-motion preview-git-idle col-start-1 row-start-1 flex items-center gap-1">
        <Sparkles className="size-3" />
        Generate
      </span>
      <span className="preview-motion preview-git-generating col-start-1 row-start-1 flex items-center gap-1 opacity-0">
        <AsciiSpinner kind="generate" className="size-3" />
        Generating
      </span>
    </span>
  );
}

/**
 * The form a git row opens in place. Mirrors `PanelCollapse` (the inset well)
 * and `commit-section.tsx`: a message box that keeps `pb-8` clear for the
 * Generate pill in its corner, then the action rows. The field goes from its
 * placeholder, to the shimmer the real form shows while the model writes, to
 * the typed-in message. It animates `grid-template-rows` the way
 * `PanelCollapse` transitions it, and is shut in the rest frame.
 */
function ActionForm({ action }: { action: SessionPanelAction }) {
  return (
    <div className="preview-motion preview-git-open grid grid-rows-[0fr] opacity-0">
      <div className="min-h-0 overflow-hidden">
        <div className="mt-0.5 mb-0.5 rounded-lg bg-primary-50 dark:bg-primary/5">
          <div className="px-2 pt-2 pb-2">
            <div className="relative min-h-16 w-full rounded-xl px-3 py-2 pb-8 text-xs text-primary-900 glass-input dark:text-primary-100">
              <span className="preview-motion preview-git-placeholder absolute inset-x-3 top-2 truncate text-primary-500">
                {action.placeholder}
              </span>
              <span className="preview-motion preview-git-generating absolute inset-0 opacity-0">
                <ShinePlaceholder>{action.generating}</ShinePlaceholder>
              </span>
              <span className="preview-motion preview-git-type block truncate [clip-path:inset(0_100%_0_0)]">
                {action.message}
              </span>
              <GeneratePill />
            </div>
          </div>
          <RowWithFill fillClassName="preview-git-press bg-primary-200/70 dark:bg-primary/10">
            <PanelItem icon={action.confirm.icon} label={action.confirm.label} />
          </RowWithFill>
        </div>
      </div>
    </div>
  );
}

/**
 * The session box. Frame, inner padding and section heading repeat
 * `session-panel.tsx`; rows come from the real `PanelItem`, so the picture
 * inherits the panel's row metrics and icon column instead of re-deriving
 * them — pass no `onClick` and each row renders as a plain div. It shrinks by
 * scaling for the same reason: restyling the type would mean a second set of
 * panel metrics to keep in step.
 *
 * Shut at rest. On hover it plays `action` — one 8s story whose parts all run
 * the `preview-git-*` loops, so they stay in step. As wide as the real panel
 * (`--session-panel-width`), so the message fits on one line like it does there.
 */
export function SessionPanelPreview({
  heading,
  rows,
  action,
}: {
  heading: string;
  rows: SessionPanelRow[];
  action: SessionPanelAction;
}) {
  return (
    <div
      aria-hidden
      className="w-(--session-panel-width) origin-top scale-90 overflow-hidden rounded-2xl bg-primary p-1.5 glass-outline dark:bg-primary-950"
    >
      <Text
        as="span"
        size="xs"
        tone="subtle"
        weight="medium"
        className="block px-2 pt-2 pb-1"
      >
        {heading}
      </Text>
      {rows.map((row, i) => {
        const trailing =
          i === 0 ? (
            <span className="grid justify-items-end">
              <span className="preview-motion preview-git-before col-start-1 row-start-1">
                {row.trailing}
              </span>
              <span className="preview-motion preview-git-after col-start-1 row-start-1 opacity-0">
                {action.done}
              </span>
            </span>
          ) : (
            row.trailing
          );
        const item = (
          <PanelItem
            icon={row.icon}
            label={row.label}
            trailing={trailing}
            expandable={row.expandable}
          />
        );
        return (
          <Fragment key={row.label}>
            {i === action.row ? (
              <RowWithFill fillClassName="preview-git-select bg-primary-50 dark:bg-primary/5">
                {item}
              </RowWithFill>
            ) : (
              item
            )}
            {i === action.row && <ActionForm action={action} />}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Length of one `preview-cycle-4` / `preview-spot-4` loop, in seconds. */
const TILE_CYCLE_DURATION = 6.4;

/**
 * A row of app-style tiles: the four agents side by side. Unlike the other
 * previews this one wears no frame — the tiles themselves are the picture, so
 * a panel behind them would just read as a second card.
 *
 * The first tile is selected at rest. On hover the selection moves along the
 * row, resting on each agent for a beat, and the tile under it lights up while
 * the others dim — the selection and the tiles share one loop. Columns are a
 * fixed tile width, so a label can't widen its column and throw the step off.
 */
export function TilesPreview({
  tiles,
}: {
  tiles: { label: string; Icon: IconComponent; iconClassName?: string }[];
}) {
  const animated = tiles.length === 4;
  return (
    <div aria-hidden className="grid auto-cols-12 grid-flow-col justify-center gap-x-3">
      <span
        className={cn(
          "col-start-1 row-start-1 size-12 rounded-2xl bg-primary/70 glass-outline dark:bg-primary/10",
          animated && "preview-motion preview-cycle-4",
        )}
        style={stepStyle("x", "calc(100% + 0.75rem)")}
      />
      {tiles.map((tile, i) => (
        <div
          key={tile.label}
          className={cn(
            "relative row-start-1 flex flex-col items-center gap-1.5",
            animated && "preview-motion preview-spot-4",
          )}
          style={{
            gridColumnStart: i + 1,
            animationDelay: slotDelay(i, 4, TILE_CYCLE_DURATION),
          }}
        >
          <span className="flex size-12 items-center justify-center rounded-2xl glass-outline glass-outline-soft">
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

export type RunLine =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "approval"; text: string };

/**
 * One line of the mirrored transcript. Every kind is a single truncated line
 * with fixed padding, so the transcript is the same height on both devices —
 * which is what keeps their scrolling in step.
 */
function RunLineView({ line }: { line: RunLine }) {
  switch (line.kind) {
    case "user":
      // What you sent wears a grey bubble, as in the app.
      return (
        <div className="ml-auto w-fit max-w-[85%] truncate rounded-md bg-primary-300/70 px-1.5 py-1 text-primary-900 dark:bg-primary-700/30 dark:text-primary-100">
          {line.text}
        </div>
      );
    case "agent":
      return (
        <div className="truncate px-0.5 py-1 text-primary-700 dark:text-primary-300">
          {line.text}
        </div>
      );
    case "tool":
      return (
        <div className="flex items-center gap-1 px-0.5 py-0.5 text-primary-500 dark:text-primary-400">
          <Check className="size-1.5 shrink-0 text-success" />
          <span className="truncate">{line.text}</span>
        </div>
      );
    case "approval":
      // Answered from the phone: what makes it remote *control*, not a second
      // screen. Allow / Deny are the answers the desktop notification offers.
      return (
        <div className="rounded-md bg-primary-200/70 px-1.5 py-1 dark:bg-primary-800/50">
          <div className="truncate text-primary-800 dark:text-primary-200">{line.text}</div>
          <div className="mt-1 flex gap-1">
            <span className="flex-1 rounded bg-primary-900 py-0.5 text-center text-primary-50 dark:bg-primary-100 dark:text-primary-900">
              Allow
            </span>
            <span className="flex-1 rounded bg-primary-300/70 py-0.5 text-center text-primary-700 dark:bg-primary-700/40 dark:text-primary-300">
              Deny
            </span>
          </div>
        </div>
      );
  }
}

/**
 * The run, scrolling. Drawn twice so `preview-scroll`'s -50% lands on the
 * copy; each copy carries its own trailing gap so the seam matches the gaps
 * inside it. Both devices run the same loop from the same hover, so they move
 * together.
 */
function Transcript({ run }: { run: RunLine[] }) {
  const copy = (
    <div className="space-y-1 pb-1">
      {run.map((line, i) => (
        <RunLineView key={i} line={line} />
      ))}
    </div>
  );
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden px-1.5 text-[6px] leading-tight mask-[linear-gradient(to_bottom,transparent_0%,black_14%,black_86%,transparent_100%)]">
      <div className="preview-motion preview-scroll">
        {copy}
        {copy}
      </div>
    </div>
  );
}

/** The session's title bar: what the run is, and that it is live. */
function SessionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-1 px-2 pb-1 text-[6.5px] font-medium text-primary-800 dark:text-primary-200">
      <span className="size-1 shrink-0 rounded-full bg-success" />
      <span className="truncate">{title}</span>
    </div>
  );
}

/** The composer, reduced to its silhouette: a pill and a send disc. */
function ComposerBar() {
  return (
    <div className="flex items-center gap-1 px-1.5 pt-1 pb-1.5">
      <span className="h-3.5 flex-1 rounded-lg bg-primary-200/80 dark:bg-primary-800/70" />
      <span className="size-3.5 shrink-0 rounded-full bg-primary-900 dark:bg-primary-100" />
    </div>
  );
}

/** Clock left, signal + battery right: what makes a rectangle read as a screen. */
function StatusBar({ time, className }: { time: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-[6px] font-semibold text-primary-800 dark:text-primary-200",
        className,
      )}
    >
      <span>{time}</span>
      <span className="flex items-center gap-0.5">
        <span className="flex items-end gap-px">
          <span className="h-0.5 w-px rounded-full bg-current" />
          <span className="h-1 w-px rounded-full bg-current" />
          <span className="h-1.5 w-px rounded-full bg-current" />
        </span>
        <span className="h-1.5 w-2.5 rounded-xs border border-current p-px">
          <span className="block h-full w-3/4 rounded-[1px] bg-current" />
        </span>
      </span>
    </div>
  );
}

/**
 * Device body: a dark bezel around the screen, the one thing that makes a
 * rounded panel read as hardware in both themes.
 */
function Device({
  className,
  screenClassName,
  children,
}: {
  className?: string;
  screenClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-primary-800 p-0.75 shadow-[0_10px_24px_-14px_rgba(0,0,0,0.7)] dark:bg-primary-700",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex h-full flex-col overflow-hidden bg-primary-50 dark:bg-primary-950",
          screenClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A phone and a tablet on the same session — the Mains Connect picture. The
 * phone has the island and home bar, the tablet the sidebar a phone has no
 * room for; both show the same run, scrolling in step on hover.
 */
export function DevicesPreview({
  title,
  workspaces,
  run,
}: {
  title: string;
  /** Tablet sidebar rows; the first is the session on screen. */
  workspaces: string[];
  run: RunLine[];
}) {
  return (
    <div aria-hidden className="flex items-center gap-3 select-none">
      <Device className="h-44 w-24 rounded-[20px]" screenClassName="rounded-[17px]">
        <span className="absolute top-1.5 left-1/2 h-1.5 w-7 -translate-x-1/2 rounded-full bg-primary-950 dark:bg-black" />
        <StatusBar time="9:41" className="px-2.5 pt-1.5 pb-1.5" />
        <SessionHeader title={title} />
        <Transcript run={run} />
        <ComposerBar />
        <span className="mx-auto mb-1 h-0.5 w-8 shrink-0 rounded-full bg-primary-400/70" />
      </Device>

      <Device className="h-34 w-52 rounded-[14px]" screenClassName="rounded-[11px]">
        <StatusBar time="9:41" className="px-2.5 pt-1 pb-1" />
        <div className="flex min-h-0 flex-1">
          <div className="w-14 shrink-0 space-y-0.5 border-r border-primary-200 px-1 pt-0.5 text-[5.5px] dark:border-primary-800">
            {workspaces.map((name, i) => (
              <div
                key={name}
                className={cn(
                  "truncate rounded px-1 py-0.5",
                  i === 0
                    ? "bg-primary-200/80 text-primary-900 dark:bg-primary-800/60 dark:text-primary-100"
                    : "text-primary-500 dark:text-primary-400",
                )}
              >
                {name}
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <SessionHeader title={title} />
            <Transcript run={run} />
            <ComposerBar />
          </div>
        </div>
      </Device>
    </div>
  );
}
