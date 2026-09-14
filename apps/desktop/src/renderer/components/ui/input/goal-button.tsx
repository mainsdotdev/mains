import { Goal } from "@/components/ui/icons";
import { Button } from "../button";

interface GoalButtonProps {
  goalMode: boolean;
  onToggle: () => void;
}

/** Goal mode on — emerald → teal → cyan, text-only gradient (mirrors
 * FastModeButton's treatment in its own color). */
const GOAL_EMERALD_STYLE = {
  text: [
    "font-medium tracking-tight bg-clip-text text-transparent",
    "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500",
    "bg-[length:140%_100%] bg-left",
    "dark:from-emerald-400 dark:via-teal-400 dark:to-cyan-400",
    "dark:bg-[length:140%_100%] dark:bg-left",
  ].join(" "),
  icon: "text-success",
} as const;

/**
 * Codex-only toggle. When on, the next message is registered as the thread's
 * goal (objective) — Codex tracks token/time usage against it and reports
 * "Goal achieved". Mirrors {@link FastModeButton}'s look/animation.
 */
export function GoalButton({ goalMode, onToggle }: GoalButtonProps) {
  const activeIcon = goalMode
    ? GOAL_EMERALD_STYLE.icon
    : "text-primary-700 dark:text-primary-300";
  const activeLabel = goalMode
    ? GOAL_EMERALD_STYLE.text
    : "text-primary-700 dark:text-primary-300";

  return (
    <Button
      tooltip="Toggle Goal Mode"
      type="button"
      onClick={onToggle}
      className={`flex items-center px-2 py-1.5 rounded-full text-sm transition-all animate-blur-reveal cursor-pointer hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300 ${
        goalMode ? "gap-1" : ""
      }`}
      title={
        goalMode
          ? "Goal mode on — sends your message as a tracked goal"
          : "Goal mode off — sends a normal turn"
      }
    >
      <Goal
        className={`size-4 shrink-0 transition-colors ${activeIcon}`}
        style={{
          transitionDelay: goalMode ? "0ms" : "200ms",
          transitionDuration: "150ms",
        }}
      />
      <span
        className={`inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] ease-[cubic-bezier(0.22,1,0.36,1)] ${activeLabel} ${
          goalMode
            ? "max-w-12 translate-x-0 opacity-100 duration-300"
            : "max-w-0 -translate-x-0.5 opacity-0 duration-200"
        }`}
      >
        Goal
      </span>
    </Button>
  );
}
