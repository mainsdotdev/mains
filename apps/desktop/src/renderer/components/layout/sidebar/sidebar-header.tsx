import { Button } from "@/components/ui";
import { Search } from "@/components/ui/icons";
import { SpaceModePicker } from "@/features/workspace/components/space-mode-picker";
import type { ModeId } from "../../../../shared/modes";
import { requestCommandMenu } from "@/features/command-menu/command-menu-bridge";

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
  return (
    <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-11">
      <div className="flex min-w-0 flex-1 items-center">
        {mode ? (
          <SpaceModePicker
            value={mode}
            providerId={providerId}
            prefixLabel="Mains"
            appearance="sidebar"
            onChange={onModeChange}
          />
        ) : (
          <span className="flex h-9 items-center px-2 text-base font-semibold text-primary-800 dark:text-primary-200">
            Mains
          </span>
        )}
      </div>
      <Button
        onClick={requestCommandMenu}
        tooltip="Search Mains "
        tooltipShortcut="(⌘⌥K)"
        aria-label="Search Mains"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-primary-600 hover:bg-primary/50 dark:text-primary-300 dark:hover:bg-primary/5"
      >
        <Search aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
