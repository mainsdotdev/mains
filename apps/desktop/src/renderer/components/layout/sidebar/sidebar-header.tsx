import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { Search } from "@/components/ui/icons";
import { SpaceModePicker } from "@/features/workspace/components/space-mode-picker";
import type { ModeId } from "../../../../shared/modes";
import {
  getCommandMenuOpen,
  requestCommandMenu,
  subscribeCommandMenuOpen,
} from "@/features/command-menu/command-menu-bridge";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";

interface SidebarHeaderProps {
  mode?: ModeId;
  providerId?: string;
  onModeChange: (mode: ModeId) => void;
}

export function SidebarHeader({
  mode,
  providerId,
  onModeChange,
}: SidebarHeaderProps) {
  const commandMenuShortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.commandMenu"),
  );
  const commandMenuOpen = useSyncExternalStore(
    subscribeCommandMenuOpen,
    getCommandMenuOpen,
  );
  return (
    <div className="flex shrink-0 items-center gap-1 px-3 pb-3 pt-11 md:pt-1">
      <div className="flex min-w-0 flex-1 items-center">
        {mode ? (
          <SpaceModePicker
            value={mode}
            providerId={providerId}
            onChange={onModeChange}
          />
        ) : (
          <span className="flex h-8 items-center px-2 text-base font-semibold text-primary-800 dark:text-primary-200">
            Mains
          </span>
        )}
      </div>
      <Button
        variant="bare"
        onClick={requestCommandMenu}
        tooltip="Search Mains"
        tooltipShortcut={commandMenuShortcut}
        tooltipPosition="bottom"
        aria-label="Search Mains"
        aria-haspopup="dialog"
        aria-expanded={commandMenuOpen}
        className={`flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 ${
          commandMenuOpen
            ? "bg-primary-200/90 text-primary-900 dark:bg-primary-800/80 dark:text-primary-50"
            : "text-primary-600 hover:bg-primary-300/20 dark:text-primary-400 dark:hover:bg-primary/10"
        }`}
      >
        <Search aria-hidden="true" className="size-4" filled={commandMenuOpen} />
      </Button>
    </div>
  );
}
