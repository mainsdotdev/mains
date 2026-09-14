import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setSubagentPanelCollapsed } from "@/lib/redux/slices/appSettingsSlice";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { useIsMobile } from "@/lib/platform";
import {
  BOTTOM_TERMINAL_HEIGHT,
  LAYOUT_PANEL_ANIM_MS,
  SESSION_PANEL_GUTTER,
} from "@/lib/layout";
import { Check, Close, Minimize, Stop } from "@/components/ui/icons";
import { AgentGlyph, Button, Caption, Text } from "@/components/ui";
import { SubagentDetail } from "@/features/workspace/components/subagent-detail";
import { useSessionSubagents } from "@/features/workspace/hooks/use-session-subagents";
import {
  subagentDisplay,
  type SubagentLifecycleState,
} from "@/features/workspace/lib/subagent-identity";
import { PanelItem, PANEL_ROW_X } from "../session-panel/panel-item";
import { selectSessionRunId } from "../session-panel/select-session-run";
import type { SessionSubagent } from "@/features/workspace/lib/select-subagents";

/** Rows shown before "Show N more" — the panel is a corner box, not a page. */
const COLLAPSED_LIMIT = 6;

/** Overshoots slightly past full size — the "pop" as the box inflates. */
const POP_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/** No overshoot on the way out; it just deflates back into the corner. */
const COLLAPSE_EASE = "cubic-bezier(0.4, 0, 1, 1)";
/**
 * Pill ↔ list ↔ detail resizes. Longer than the mount pop and on a fast-out
 * slow-in curve, so the box glides between measured sizes instead of snapping —
 * `width`/`height` can only interpolate between numbers, which is why the box
 * animates measured pixels while the content inside renders at its natural
 * size (see the inner wrapper below).
 */
const RESIZE_MS = 300;
const RESIZE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const STATE_TEXT: Record<Exclude<SubagentLifecycleState, "running">, string> = {
  done: "text-success dark:text-success",
  failed: "text-danger dark:text-danger",
  stopped: "text-warning dark:text-warning",
};

/**
 * Terminal-state marker only — a running agent needs no trailing indicator,
 * its glyph is already twinkling on the left of the row.
 */
function StateIcon({
  state,
}: {
  state: Exclude<SubagentLifecycleState, "running">;
}) {
  if (state === "done") return <Check className="size-3.5" />;
  if (state === "failed") return <Close className="size-3.5" />;
  return <Stop className="size-3.5" />;
}

/**
 * The subagent box: the session box's mirror, pinned to the bottom-right
 * corner. It appears on its own the moment the open run spawns an agent,
 * collapses to a small pill when dismissed (a new spawn re-opens it), and
 * clicking an agent grows the box up-and-left into that agent's full flow.
 *
 * Like the session box it lies over the content surface rather than taking a
 * column out of it; when another panel claims the right edge it hides
 * entirely (the shell's `shown` gate) instead of floating.
 */
export function SubagentPanel({
  shown,
  laneOffset,
}: {
  /**
   * External layout gate, computed in the app shell alongside the content
   * inset — false while ANY panel owns the right edge, on hidden routes, etc.
   * (So unlike the session box, this one never "floats": whenever it is
   * visible at all, the lane is free.) The panel still requires agents of
   * its own before appearing.
   */
  shown: boolean;
  /** Width of whatever else occupies the right lane, as a CSS length. */
  laneOffset: string;
}) {
  const dispatch = useAppDispatch();
  const isMobile = useIsMobile();
  const runId = useAppSelector((state) => selectSessionRunId(state.workspace));
  const collapsed = useAppSelector(
    (state) => state.appSettings.subagentPanelCollapsed,
  );
  const terminalOpen = useAppSelector(
    (state) => state.appSettings.bottomTerminalOpen,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isExpandedList, setIsExpandedList] = useState(false);

  const subagents = useSessionSubagents(runId);

  // Selection is contextual (a specific agent of a specific run) and resets
  // per run. Pill-vs-list deliberately does NOT reset or auto-open on new
  // spawns — it's a persisted preference; the pill's count and twinkling
  // glyphs already signal new activity.
  const prevRunRef = useRef(runId);
  useEffect(() => {
    if (prevRunRef.current !== runId) {
      prevRunRef.current = runId;
      setSelectedId(null);
      setIsExpandedList(false);
    }
  }, [runId]);

  const isVisibleTarget = shown && !!runId && subagents.length > 0;
  const { isVisible, isAnimatedIn } = usePanelAnimation(isVisibleTarget);
  // Single gate for both the null return below and the measurement effect —
  // they must agree, or the observer outlives the DOM it measures.
  const mounted = isVisible && !!runId;

  const selected = selectedId
    ? subagents.find((agent) => agent.providerCallId === selectedId)
    : undefined;
  const expanded = !!selected && !collapsed;

  // The outer box animates between MEASURED pixel sizes; the inner wrapper
  // renders each state (pill / list / detail) at its natural size and a
  // ResizeObserver feeds it back. CSS cannot interpolate from `auto`, so
  // animating the measurement is the only way every leg of
  // pill ↔ list ↔ detail glides — including the list growing a row.
  const innerRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) {
      // The body just left the DOM. A stale measurement would deadlock the
      // next appearance: the outer box renders at the old size, the inner
      // wrapper (absolute, shrink-to-fit) measures against that box, and a
      // 0×0 box can never measure its way back out. Reopen from natural size.
      setBoxSize(null);
      return;
    }
    const measure = () =>
      setBoxSize((prev) => {
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        // ResizeObserver reports 0×0 when the node detaches — that's the
        // element leaving, not a size to animate to.
        if (width === 0 && height === 0) return prev;
        return prev && prev.width === width && prev.height === height
          ? prev
          : { width, height };
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted]);

  if (!mounted) return null;

  // Keyed content: a state change remounts the body with a quick fade so the
  // swap reads as one motion with the resize instead of an instant cut.
  const mode = collapsed
    ? "pill"
    : expanded && selected
      ? `detail-${selected.providerCallId}`
      : "list";

  const right = isMobile
    ? "0.8125rem"
    : `calc(${laneOffset} + ${SESSION_PANEL_GUTTER})`;

  return (
    <div
      className={`fixed z-(--z-panel-toggle) overflow-hidden rounded-2xl glass-outline dark:bg-primary-950 bg-primary will-change-transform ${
        // Docked in the list state it shares the layout (no lift needed); the
        // pill and the expanded flow both lie over the chat, so they get one.
        expanded || collapsed ? "shadow-2xl" : ""
      }`}
      style={{
        // Hops above the bottom terminal when it opens, tracking the drawer's
        // own 300ms ease-out height animation.
        bottom: terminalOpen
          ? `calc(0.8125rem + env(safe-area-inset-bottom) + ${BOTTOM_TERMINAL_HEIGHT})`
          : "calc(1.375rem + env(safe-area-inset-bottom))",
        right,
        // Grows out of the bottom-right corner — leftward and upward — so it
        // reads as inflating from where it lives, mirroring the session box.
        transformOrigin: "bottom right",
        width: boxSize?.width,
        height: boxSize?.height,
        transform: isAnimatedIn ? "scale(1)" : "scale(0.86)",
        opacity: isAnimatedIn ? 1 : 0,
        transition: [
          `transform ${LAYOUT_PANEL_ANIM_MS}ms ${isAnimatedIn ? POP_EASE : COLLAPSE_EASE}`,
          `opacity ${isAnimatedIn ? LAYOUT_PANEL_ANIM_MS : LAYOUT_PANEL_ANIM_MS * 0.6}ms ease-out`,
          `width ${RESIZE_MS}ms ${RESIZE_EASE}`,
          `height ${RESIZE_MS}ms ${RESIZE_EASE}`,
          `right ${LAYOUT_PANEL_ANIM_MS}ms ease-out`,
          // Matches the terminal drawer's transition so the hop rides with it.
          "bottom 300ms ease-out",
        ].join(", "),
      }}
      role="complementary"
      aria-label="Subagent panel"
    >
      {/* Natural-size layer the outer box clips while it catches up. Anchored
          bottom-right so mid-animation the content hugs the corner the box
          grows from, instead of being cropped at its far edge. */}
      <div className="absolute right-0 bottom-0">
        <div
          ref={innerRef}
          style={{
            width: collapsed
              ? "max-content"
              : expanded
                ? "min(40rem, calc(100vw - 3rem))"
                : "var(--session-panel-width)",
            height: expanded ? "min(60vh, 44rem)" : undefined,
          }}
        >
          <div
            key={mode}
            className="h-full"
            style={{ animation: "fade 160ms ease-out both" }}
          >
            {collapsed ? (
              <CollapsedPill
                subagents={subagents}
                onOpen={() => dispatch(setSubagentPanelCollapsed(false))}
              />
            ) : expanded && selected ? (
              <SubagentDetail
                runId={runId}
                subagentId={selected.providerCallId!}
                title={subagentDisplay(selected).name}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <SubagentList
                subagents={subagents}
                isExpandedList={isExpandedList}
                onToggleExpandedList={() => setIsExpandedList((v) => !v)}
                onSelect={(agent) => setSelectedId(agent.providerCallId)}
                onCollapse={() => dispatch(setSubagentPanelCollapsed(true))}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dismissed state: a small pill with the agents' glyphs and count. */
function CollapsedPill({
  subagents,
  onOpen,
}: {
  subagents: SessionSubagent[];
  onOpen: () => void;
}) {
  const running = subagents.filter((agent) => agent.state === "running").length;
  return (
    <Button
      onClick={onOpen}
      title="Show subagents"
      aria-label="Show subagents"
      className="flex items-center gap-2 px-2.5 py-2 transition-colors hover:bg-primary-50 dark:hover:bg-primary/5"
    >
      {subagents.slice(0, 3).map((agent) => {
        const name = subagentDisplay(agent).name;
        return (
          <AgentGlyph
            key={agent.id}
            seed={name}
            active={agent.state === "running"}
            className="size-3.5"
          />
        );
      })}
      <Text as="span" size="s" tone="muted" weight="medium" className="tabular-nums">
        {running > 0 ? `${running}/${subagents.length}` : subagents.length}
      </Text>
    </Button>
  );
}

function SubagentList({
  subagents,
  isExpandedList,
  onToggleExpandedList,
  onSelect,
  onCollapse,
}: {
  subagents: SessionSubagent[];
  isExpandedList: boolean;
  onToggleExpandedList: () => void;
  onSelect: (agent: SessionSubagent) => void;
  onCollapse: () => void;
}) {
  const visible = isExpandedList
    ? subagents
    : subagents.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = subagents.length - visible.length;

  return (
    <div className="max-h-[40vh] overflow-y-auto noscrollbar">
      <div
        className={`flex items-center justify-between gap-2 py-2 ${PANEL_ROW_X}`}
      >
        <Caption size="s" weight="medium">
          Subagents ({subagents.length})
        </Caption>

        <span className="flex items-center gap-1">
          <Button
            onClick={onCollapse}
            title="Hide subagents"
            aria-label="Hide subagents"
            className="rounded-md p-0.5 text-primary-400 transition-colors hover:bg-primary-50 hover:text-primary-900 dark:hover:bg-primary/5 dark:hover:text-primary-100"
          >
            <Minimize className="size-4 scale-x-[-1] text-primary-700 dark:text-primary-300 " />
          </Button>
        </span>
      </div>

      {visible.map((agent) => {
        const display = subagentDisplay(agent);
        // Quiet while running — no live step, no type chatter; the twinkling
        // glyph carries "working" and the secondary slot fills on completion.
        const secondary =
          agent.state === "running" ? undefined : display.detail;
        return (
          <PanelItem
            key={agent.id}
            icon={
              <AgentGlyph
                seed={display.name}
                active={agent.state === "running"}
                className="size-3.5"
              />
            }
            title={secondary ?? display.name}
            // Old runs predate parent linkage — there is no detail to open, so
            // the row stays a plain status line (PanelItem without onClick).
            onClick={agent.providerCallId ? () => onSelect(agent) : undefined}
            label={
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{display.name}</span>
                {/* {secondary && (
                  <span className="truncate font-normal text-primary-600 dark:text-primary-400">
                    {secondary}
                  </span>
                )} */}
              </span>
            }
            trailing={
              agent.state === "running" ? undefined : (
                <span className={STATE_TEXT[agent.state]}>
                  <StateIcon state={agent.state} />
                </span>
              )
            }
          />
        );
      })}

      {(hiddenCount > 0 || isExpandedList) && (
        <PanelItem
          icon={<span className="block size-4" />}
          label={
            <Text as="span" size="xs" tone="faint">
              {isExpandedList ? "Show less" : `Show ${hiddenCount} more`}
            </Text>
          }
          onClick={onToggleExpandedList}
        />
      )}
    </div>
  );
}
