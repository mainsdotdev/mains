import { forwardRef, useState } from "react";
import { Button } from "@/components/ui";
import { Sparkles } from "@/components/ui/icons";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import type { SkillInfo } from "@/lib/redux/api/providersApi";

/** How many plugin icons the stack shows before it just reads as "many". */
const MAX_STACKED_ICONS = 3;

function StackedPluginIcon({ skill }: { skill: SkillInfo }) {
  const [failed, setFailed] = useState(false);
  const iconPath = skill.iconSmall || skill.iconLarge;
  const resolved = useLocalImageUrl(iconPath);
  const frame =
    "size-4 rounded-sm shrink-0 ring-2 ring-background dark:ring-primary-900";
  if (iconPath && resolved && !failed) {
    return (
      <img
        src={resolved}
        alt=""
        className={`${frame} object-contain`}
        style={skill.brandColor ? { backgroundColor: skill.brandColor } : undefined}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={`${frame} flex items-center justify-center bg-primary-200/50 dark:bg-primary-700/50 text-primary-600 dark:text-primary-400`}
      style={skill.brandColor ? { backgroundColor: skill.brandColor, color: "#fff" } : undefined}
    >
      <Sparkles className="size-2.5" />
    </div>
  );
}

interface PluginsButtonProps {
  /** Installed plugin skills (scope `plugin`); the first few supply the icon stack. */
  plugins: SkillInfo[];
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Toolbar entry point to the plugins picker: a stack of the installed plugins'
 * icons plus a "Plugins" label. Clicking opens the unified context menu
 * narrowed to the plugins bucket (see `UnifiedContextBucket`). The ref is the
 * click-outside exclusion for that menu, so a second click toggles it closed
 * instead of closing-then-reopening.
 */
export const PluginsButton = forwardRef<HTMLButtonElement, PluginsButtonProps>(
  function PluginsButton({ plugins, isOpen, onToggle }, ref) {
    const stack = plugins.slice(0, MAX_STACKED_ICONS);
    return (
      <Button
        ref={ref}
        type="button"
        tooltip="Add a plugin to this message"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full text-sm transition-colors animate-blur-reveal cursor-pointer hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300 ${
          isOpen ? "bg-primary-200/30 dark:bg-primary-800" : ""
        }`}
      >
        <span className="flex items-center -space-x-1">
          {stack.map((skill) => (
            <StackedPluginIcon key={`${skill.name}-${skill.path ?? ""}`} skill={skill} />
          ))}
        </span>
        <span className="whitespace-nowrap">Plugins</span>
      </Button>
    );
  },
);
