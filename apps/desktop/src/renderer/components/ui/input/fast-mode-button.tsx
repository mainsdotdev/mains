import { BoltFill } from "@/components/ui/icons";
import { Bolt } from "@/components/ui/icons/space";
import { Button } from "../button";

interface FastModeButtonProps {
  fastMode: boolean;
  onToggle: () => void;
}

/** Fast mode on — violet (violet → purple → fuchsia), no filled background. */
const FAST_VIOLET_STYLE = {
  text: [
    "font-medium tracking-tight bg-clip-text text-transparent",
    "bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500",
    "bg-[length:140%_100%] bg-left",
    "dark:from-violet-400 dark:via-purple-400 dark:to-fuchsia-400",
    "dark:bg-[length:140%_100%] dark:bg-left",
  ].join(" "),
  icon: "text-violet-500 dark:text-violet-400",
} as const;

export function FastModeButton({ fastMode, onToggle }: FastModeButtonProps) {
  const activeIcon = fastMode
    ? FAST_VIOLET_STYLE.icon
    : "text-primary-700 dark:text-primary-300";
  const activeLabel = fastMode
    ? FAST_VIOLET_STYLE.text
    : "text-primary-700 dark:text-primary-300";

  return (
    <Button
      tooltip="Toggle Fast Mode"
      type="button"
      onClick={onToggle}
      className={`flex items-center px-2 py-1.5 rounded-full text-sm transition-all animate-blur-reveal cursor-pointer hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300 ${
        fastMode ? "gap-1" : ""
      }`}
      title={
        fastMode
          ? "Fast mode on — faster output, same model"
          : "Fast mode off — standard speed"
      }
    >
      {fastMode ? (
        <BoltFill
          className={`size-4 shrink-0 transition-colors ${activeIcon}`}
          style={{
            transitionDelay: "0ms",
            transitionDuration: "150ms",
          }}
        />
      ) : (
        <Bolt
          className={`size-4 shrink-0 transition-colors ${activeIcon}`}
          style={{
            transitionDelay: "200ms",
            transitionDuration: "150ms",
          }}
        />
      )}
      <span
        className={`inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] ease-[cubic-bezier(0.22,1,0.36,1)] ${activeLabel} ${
          fastMode
            ? "max-w-11 translate-x-0 opacity-100 duration-300"
            : "max-w-0 -translate-x-0.5 opacity-0 duration-200"
        }`}
      >
        Fast
      </span>
    </Button>
  );
}
