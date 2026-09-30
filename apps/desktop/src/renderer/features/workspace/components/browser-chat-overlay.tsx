import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  LazyMotion,
  MotionConfig,
  animate,
  domAnimation,
  m,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { AsciiSpinner, Button } from "@/components/ui";
import { Chat, Minimize } from "@/components/ui/icons";
import type { BrowserChatMode } from "@/hooks/use-browser-panel";
import { formatRunElapsed, lastActivityLine } from "../lib/background-runs";
import type { Run, RunEvent } from "../types";

function latestRunActivity(events: RunEvent[], liveOnly = false): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (liveOnly && event.metadata?.streaming !== true) continue;
    if (event.metadata?.isFromSubagent || !event.content.trim()) continue;
    const kind = event.metadata?.kind;
    if (
      event.type === "artifact" &&
      (kind === "thinking" || kind === "response" || kind === "text" || kind === "report")
    ) {
      const line = lastActivityLine(event.content);
      if (line) return line.replace(/\s+/g, " ");
    }
    if (event.type === "log" && event.content.startsWith("[thinking] ")) {
      const line = lastActivityLine(event.content.slice("[thinking] ".length));
      if (line) return line.replace(/\s+/g, " ");
    }
  }
  return null;
}

/** The compact composer shows the selected run's progress while it is active. */
export function browserChatRunStatus(
  events: RunEvent[],
  run: Run | null,
  nowMs: number,
): string | null {
  if (run?.status !== "running" && run?.status !== "queued") return null;
  if (run.status === "queued") {
    return `Queued · ${run.title?.trim() || run.goal?.trim() || "Waiting to start"}`;
  }
  const elapsed = formatRunElapsed(run, nowMs);
  // Older transcript rows can belong to a previous turn. The compact bar
  // mirrors the background card's live activity line instead.
  const activity = latestRunActivity(events, true);
  return `Working for ${elapsed}${activity ? ` · ${activity}` : ""}`;
}

const CHAT_BAR_SIZE = 48;
const CHAT_WIDTH = 540;
const CHAT_HEIGHT_LIMIT = 672;
const CHAT_EDGE_INSET = 16;
const SURFACE_SPRING = {
  type: "spring" as const,
  stiffness: 500,
  damping: 45,
  mass: 1,
};
const VERTICAL_TRANSITION = {
  type: "tween" as const,
  duration: 0.28,
  ease: "linear" as const,
};

export function browserChatTransition(
  from: BrowserChatMode,
  to: BrowserChatMode,
  reduceMotion: boolean,
) {
  if (reduceMotion) return { duration: 0 };
  if (
    (from === "input" && to === "details") ||
    (from === "details" && to === "input")
  ) {
    return VERTICAL_TRANSITION;
  }
  return SURFACE_SPRING;
}

/** All non-icon states share a width so the composer grows straight upward. */
export function browserChatSize(
  mode: BrowserChatMode,
  stage: { width: number; height: number },
  composerHeight = CHAT_BAR_SIZE,
): { width: number; height: number } {
  if (mode === "icon") return { width: CHAT_BAR_SIZE, height: CHAT_BAR_SIZE };
  const width = Math.min(
    CHAT_WIDTH,
    Math.max(CHAT_BAR_SIZE, stage.width - CHAT_EDGE_INSET * 2),
  );
  if (mode === "input") {
    return {
      width,
      height: Math.min(
        Math.max(CHAT_BAR_SIZE, stage.height - CHAT_EDGE_INSET * 2),
        Math.max(CHAT_BAR_SIZE, composerHeight),
      ),
    };
  }
  const transcriptHeight = Math.min(
      CHAT_HEIGHT_LIMIT,
      Math.max(CHAT_BAR_SIZE, stage.height / 2),
      Math.max(CHAT_BAR_SIZE, stage.height - CHAT_EDGE_INSET * 2),
    );
  return {
    width,
    height: Math.min(
      Math.max(CHAT_BAR_SIZE, stage.height - CHAT_EDGE_INSET * 2),
      transcriptHeight + Math.max(0, composerHeight - CHAT_BAR_SIZE),
    ),
  };
}

interface BrowserChatOverlayProps {
  run: Run | null;
  mode: BrowserChatMode;
  onShowDetails: () => void;
  onMinimize: () => void;
  onComposerHeightChange?: (height: number) => void;
  composer?: ReactNode;
  children?: ReactNode;
}

export function BrowserChatOverlay({
  run,
  mode,
  onShowDetails,
  onMinimize,
  onComposerHeightChange,
  composer,
  children,
}: BrowserChatOverlayProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(CHAT_BAR_SIZE);
  const [stageSize, setStageSize] = useState(() => ({
    width:
      typeof window === "undefined"
        ? CHAT_WIDTH + CHAT_EDGE_INSET * 2
        : window.innerWidth,
    height:
      typeof window === "undefined"
        ? CHAT_HEIGHT_LIMIT * 2
        : window.innerHeight,
  }));
  const reduceMotion = useReducedMotion();
  const initialSize = browserChatSize(mode, stageSize, composerHeight);
  const surfaceWidth = useMotionValue(initialSize.width);
  const surfaceHeight = useMotionValue(initialSize.height);
  const surfaceRadius = useMotionValue(mode === "icon" ? 24 : 28);
  const composerOpacity = useMotionValue(mode === "icon" ? 0 : 1);
  const detailsOpacity = useMotionValue(mode === "details" ? 1 : 0);
  const iconOpacity = useMotionValue(mode === "icon" ? 1 : 0);
  const animatedComposerHeight = useMotionValue(composerHeight);
  const [modeChange, setModeChange] = useState(() => ({ to: mode, active: false }));
  const lastVisualTarget = useRef({ mode, ...stageSize, composerHeight, reduceMotion });
  if (modeChange.to !== mode) {
    setModeChange({ to: mode, active: true });
  }

  useLayoutEffect(() => {
    const previous = lastVisualTarget.current;
    if (
      previous.mode === mode && previous.width === stageSize.width &&
      previous.height === stageSize.height &&
      previous.composerHeight === composerHeight && previous.reduceMotion === reduceMotion
    ) return;
    lastVisualTarget.current = { mode, ...stageSize, composerHeight, reduceMotion };

    const size = browserChatSize(mode, stageSize, composerHeight);
    const from = {
      width: surfaceWidth.get(),
      height: surfaceHeight.get(),
      radius: surfaceRadius.get(),
      composerOpacity: composerOpacity.get(),
      detailsOpacity: detailsOpacity.get(),
      iconOpacity: iconOpacity.get(),
      composerHeight: animatedComposerHeight.get(),
    };
    const to = {
      width: size.width,
      height: size.height,
      radius: mode === "icon" ? 24 : 28,
      composerOpacity: mode === "icon" ? 0 : 1,
      detailsOpacity: mode === "details" ? 1 : 0,
      iconOpacity: mode === "icon" ? 1 : 0,
      composerHeight,
    };
    const fromIcon = previous.mode === "icon" && mode !== "icon";
    const toIcon = mode === "icon" && previous.mode !== "icon";
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const mix = (start: number, end: number, progress: number) =>
      start + (end - start) * progress;
    const frame = (progress: number) => {
      const geometryProgress = clamp(progress);
      // One clock grows the card in both directions. Reveal its contents only
      // after there is room for them, then reverse that order on collapse.
      const contentProgress = fromIcon
        ? clamp((progress - 0.35) / 0.5)
        : toIcon ? clamp(progress / 0.6) : progress;
      const iconProgress = fromIcon
        ? clamp(progress / 0.5)
        : toIcon ? clamp((progress - 0.45) / 0.45) : progress;
      surfaceWidth.set(mix(from.width, to.width, geometryProgress));
      surfaceHeight.set(mix(from.height, to.height, geometryProgress));
      surfaceRadius.set(mix(from.radius, to.radius, geometryProgress));
      composerOpacity.set(mix(from.composerOpacity, to.composerOpacity, contentProgress));
      detailsOpacity.set(mix(from.detailsOpacity, to.detailsOpacity, contentProgress));
      iconOpacity.set(mix(from.iconOpacity, to.iconOpacity, iconProgress));
      animatedComposerHeight.set(mix(from.composerHeight, to.composerHeight, geometryProgress));
    };
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      frame(1);
      setModeChange((current) =>
        current.to === mode && current.active ? { ...current, active: false } : current,
      );
    };
    if (reduceMotion) {
      finish();
      return;
    }
    const transition = previous.mode === mode
      ? { type: "tween" as const, duration: 0.18, ease: [0.22, 1, 0.36, 1] as const }
      : browserChatTransition(previous.mode, mode, false);
    const animation = animate(0, 1, { ...transition, onUpdate: frame });
    void animation.then(() => {
      finish();
    });
    return () => {
      cancelled = true;
      animation.stop();
    };
  }, [mode, stageSize, composerHeight, reduceMotion, surfaceWidth, surfaceHeight,
    surfaceRadius, composerOpacity, detailsOpacity, iconOpacity, animatedComposerHeight]);

  useLayoutEffect(() => {
    const stage = surfaceRef.current?.parentElement;
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      const width = rect.width || stage.clientWidth || window.innerWidth;
      const height = rect.height || stage.clientHeight || window.innerHeight;
      setStageSize((current) =>
        current?.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useLayoutEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    const measure = () => {
      const height = Math.max(
        CHAT_BAR_SIZE,
        Math.ceil(node.getBoundingClientRect().height || node.offsetHeight),
      );
      setComposerHeight((current) => current === height ? current : height);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (mode !== "icon") onComposerHeightChange?.(composerHeight);
  }, [composerHeight, mode, onComposerHeightChange]);

  const title = run?.title?.trim() || run?.goal?.trim() || "New chat";
  const runIsActive = run?.status === "running" || run?.status === "queued";
  const fullWidth = browserChatSize("details", stageSize, composerHeight).width;

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <m.div
          ref={surfaceRef}
          data-testid="browser-chat-surface"
          data-browser-chat-surface=""
          data-state={mode}
          role={mode === "details" ? "region" : undefined}
          aria-label={mode === "details" ? "Selected chat" : undefined}
          onClick={mode === "icon" ? onShowDetails : undefined}
          initial={false}
          style={{
            width: surfaceWidth,
            height: surfaceHeight,
            borderRadius: surfaceRadius,
            transformOrigin: "bottom right",
            contain: "layout",
          }}
          className={
            `pointer-events-auto absolute bottom-4 right-4 glass-outline before:z-20 text-primary-950 transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none dark:text-primary-50 ${mode === "icon" || modeChange.active ? "overflow-hidden " : ""}${mode === "icon" ? "cursor-pointer " : ""}` +
            (mode === "input"
              ? "border-transparent bg-transparent shadow-none"
              : " bg-primary-50 dark:bg-primary-900")
          }
        >
          <m.div
            className="absolute inset-y-0 right-0 flex min-h-0 flex-col"
            aria-hidden={mode !== "details"}
            inert={mode !== "details"}
            style={{
              width: fullWidth,
              opacity: detailsOpacity,
              pointerEvents: mode === "details" ? "auto" : "none",
            }}
          >
            <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-primary-200/60 px-3.5 dark:border-primary/5">
              <Button
                onClick={onMinimize}
                aria-label="Minimize chat"
                tooltip="Minimize chat"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-primary-600 hover:bg-primary-200/60 hover:text-primary-950 dark:text-primary-300 dark:hover:bg-primary-800 dark:hover:text-primary-50"
              >
                <Minimize className="size-4 rotate-y-180" />
              </Button>
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
                {title}
              </span>
            </div>
            <m.div
              className="flex min-h-0 flex-1 flex-col"
              style={{ paddingBottom: animatedComposerHeight }}
            >
              {run ? children : <div className="min-h-0 flex-1" />}
            </m.div>
          </m.div>
          <m.div
            className="absolute bottom-0 right-0 bg-primary-50 dark:bg-primary-900"
            aria-hidden={mode === "icon"}
            inert={mode === "icon"}
            style={{
              width: fullWidth,
              borderRadius: surfaceRadius,
              pointerEvents: mode === "icon" ? "none" : "auto",
            }}
          >
            <m.div
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary-200/60 dark:bg-primary/5"
              style={{ opacity: detailsOpacity }}
            />
            <m.div ref={composerRef} style={{ opacity: composerOpacity }}>
              {composer}
            </m.div>
          </m.div>
          <m.div
            className="absolute bottom-0 right-0 z-30 size-12"
            aria-hidden={mode !== "icon"}
            inert={mode !== "icon"}
            style={{
              opacity: iconOpacity,
              pointerEvents: mode === "icon" ? "auto" : "none",
            }}
            initial={false}
          >
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onShowDetails();
              }}
              aria-label="Show chat"
              tooltipPosition="top-left"
              tooltip={run?.title?.trim() || "New run"}
              tabIndex={mode === "icon" ? 0 : -1}
              className="flex size-full items-center justify-center rounded-full text-primary-800 hover:bg-primary-100 dark:text-primary-100 dark:hover:bg-primary-800"
            >
              {runIsActive ? (
                <AsciiSpinner
                  variant="inherit"
                  kind={run.status === "queued" ? "circle" : "square"}
                  className="size-4"
                />
              ) : (
                <Chat className="size-5" />
              )}
            </Button>
          </m.div>
        </m.div>
      </MotionConfig>
    </LazyMotion>
  );
}
