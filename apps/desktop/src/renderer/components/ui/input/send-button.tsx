import type { ReactNode } from "react";
import { Button } from "../button";
import { ChevronUp, Stop } from "../icons";

interface SendButtonProps {
  loading: boolean;
  onSubmit: () => void;
  onStop?: () => void;
  disabled?: boolean;
  compact?: boolean;
  showStop?: boolean;
  label?: string;
  icon?: ReactNode;
  /** Select the alternate icon while keeping it mounted for the crossfade. */
  showCustomIcon?: boolean;
  stopLabel?: string;
  stopDisabled?: boolean;
}

export function SendButton({
  loading,
  onSubmit,
  onStop,
  disabled = false,
  compact = false,
  showStop = loading && !!onStop,
  label = "Send prompt",
  icon,
  showCustomIcon = !!icon,
  stopLabel = "Stop run",
  stopDisabled = false,
}: SendButtonProps) {
  const stopping = showStop && !!onStop;
  const submitting = loading && !stopping;
  const isDisabled = stopping ? stopDisabled : loading || disabled;
  const actionLabel = stopping ? stopLabel : label;
  const sizing = compact ? "size-6.5 p-1" : "size-7.5 p-1";
  const activeIcon = submitting ? "loading" : stopping ? "stop" : showCustomIcon && icon ? "custom" : "send";
  const iconLayer = "absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[active=true]:opacity-100 motion-reduce:duration-75 [&>svg]:size-full [&>svg]:shrink-0 [&>svg]:text-inherit";

  return (
    <Button
      type="button"
      tooltip={actionLabel}
      onClick={() => {
        if (isDisabled) return;
        if (stopping) onStop?.();
        else onSubmit();
      }}
      className={`${sizing} relative inline-flex shrink-0 items-center justify-center rounded-full bg-primary-800 text-primary-200 dark:bg-primary-200 dark:text-primary-800 disabled:opacity-70 transition-[color,background-color,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-75`}
      aria-label={submitting ? "Submitting..." : actionLabel}
      aria-busy={submitting || undefined}
      disabled={isDisabled}
    >
      <span aria-hidden="true" className={`pointer-events-none relative flex ${compact ? "size-4" : "size-5"} shrink-0 items-center justify-center`}>
        <span data-active={activeIcon === "send"} className={iconLayer}>
          <ChevronUp />
        </span>
        <span data-active={activeIcon === "custom"} className={iconLayer}>
          {icon}
        </span>
        <span data-active={activeIcon === "stop"} className={iconLayer}>
          <Stop />
        </span>
        <span data-active={activeIcon === "loading"} className={iconLayer}>
          <span className={`size-full rounded-full border-2 border-current border-t-transparent ${submitting ? "animate-spin motion-reduce:animate-none" : ""}`} />
        </span>
      </span>
    </Button>
  );
}
