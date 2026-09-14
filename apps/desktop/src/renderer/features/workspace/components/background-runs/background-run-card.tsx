import { useEffect, useRef, useState } from "react";
import { AsciiSpinner, Button, Text } from "@/components/ui";
import { Check, Close, Error, Stop } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { getProviderVariantById } from "@/lib/provider-variants";
import type { ActiveRun } from "@/lib/redux/api";
import {
  backgroundRunLabel,
  formatRunElapsed,
  isRunFinished,
  runOutcomeLabel,
} from "../../lib/background-runs";

/** How long the stop button stays armed before it forgets the first click. */
const ARM_TIMEOUT_MS = 3000;

interface BackgroundRunCardProps {
  run: ActiveRun;
  /** Latest streamed line, shown as the "now playing" subtitle. */
  activity?: string;
  /** Ticks once a second so the elapsed label advances. */
  nowMs: number;
  isStopping: boolean;
  onOpen: () => void;
  onStop: () => void;
}

/**
 * One backgrounded run. The body is the jump target; the ✕ stops the run and
 * arms first — an accidental click on a card the user meant to open would
 * otherwise throw away a live agent turn.
 */
export function BackgroundRunCard({
  run,
  activity,
  nowMs,
  isStopping,
  onOpen,
  onStop,
}: BackgroundRunCardProps) {
  const [isArmed, setIsArmed] = useState(false);
  const armTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    };
  }, []);

  const handleStopClick = () => {
    if (isStopping) return;
    if (!isArmed) {
      setIsArmed(true);
      armTimerRef.current = window.setTimeout(
        () => setIsArmed(false),
        ARM_TIMEOUT_MS,
      );
      return;
    }
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    setIsArmed(false);
    onStop();
  };

  const descriptor = getProviderVariantById(run.providerId);
  const ProviderIcon = descriptor?.icon;
  const label = backgroundRunLabel(run);
  const elapsed = formatRunElapsed(run, nowMs);
  // A finished run is held on the dock for a few seconds so its outcome is
  // seen. Everything about the card that implies ongoing work — the spinner,
  // the live activity line, the stop button — belongs to the working state.
  const isFinished = isRunFinished(run);
  const subtitle = [
    descriptor?.label,
    run.workspace?.name,
    elapsed,
    isFinished ? runOutcomeLabel(run) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onOpen}
        title={label}
        aria-label={`Open ${label}`}
        className="w-full text-left rounded-2xl glass-outline bg-primary dark:bg-primary-950 hover:bg-primary-50 dark:hover:bg-primary-950 px-2.5 py-2 pr-8 cursor-pointer transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {/* Every label is a <span>: a button's content model is phrasing only. */}
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 flex items-center size-3 justify-center">
            {isFinished ? (
              <OutcomeGlyph status={run.status} />
            ) : (
              <AsciiSpinner
                variant={descriptor?.variant ?? "null"}
                kind={run.status === "queued" ? "circle" : "square"}
              />
            )}
          </span>
          <Text
            as="span"
            size="s"
            weight="normal"
            tone="contrast"
            className="truncate"
          >
            {label}
          </Text>
        </span>
        <span className="mt-1 flex items-center gap-1.5 min-w-0">
          {ProviderIcon && (
            // These marks are `fill="currentColor"`, and only Claude's variant
            // ships a tint — the rest would inherit the root color and read as
            // black on the card, so they fall back to the subtitle's tone.
            // Either/or, not a merge: `text-claude` and `dark:text-primary-300`
            // are different variants, so tailwind-merge keeps both and the dark
            // theme would win, quietly greying out the one tinted icon.
            <ProviderIcon
              className={cn(
                "size-3 shrink-0",
                descriptor?.accentClassName ??
                  "text-primary-900 dark:text-primary-100",
              )}
            />
          )}
          <Text as="span" size="xxs" tone="default" className="truncate">
            {subtitle}
          </Text>
        </span>
        {activity && !isFinished && (
          <Text
            as="span"
            size="t"
            tone="default"
            className="mt-0.5 block truncate shine-text"
          >
            {activity}
          </Text>
        )}
      </button>

      {!isFinished && (
        <Button
          onClick={handleStopClick}
          disabled={isStopping}
          tooltip={
            isStopping
              ? "Stopping…"
              : isArmed
                ? "Click again to stop"
                : "Stop run"
          }
          tooltipPosition="top-right"
          aria-label={isArmed ? "Confirm stopping this run" : "Stop this run"}
          className={cn(
            "absolute top-1.5 right-1.5 p-1 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
            (isArmed || isStopping) && "opacity-100",
            isArmed
              ? "bg-danger/15 text-danger "
              : "text-primary-700 dark:text-primary-300 hover:bg-primary-200/40 dark:hover:bg-primary-700/40",
          )}
        >
          <Close className="size-3" />
        </Button>
      )}
    </div>
  );
}

/** How a held card reports the way its run ended. */
function OutcomeGlyph({ status }: { status: ActiveRun["status"] }) {
  if (status === "succeeded") return <Check className="size-3 text-success" />;
  if (status === "failed") return <Error className="size-3 text-danger" />;
  return <Stop className="size-3 text-primary-700 dark:text-primary-300" />;
}
