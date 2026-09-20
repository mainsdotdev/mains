import type { CSSProperties } from "react";
import { Settings, Question } from "@/components/ui/icons";
import SpaceSelector from "./space-selector";
import type { Space } from "@/lib/redux/api";
import { Button } from "@/components/ui";
import {
  useKeyboardShortcut,
  useKeyboardShortcutBinding,
} from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";

interface SidebarFooterProps {
  spaces: Space[];
  activeSpaceId: string | null;
  onSpaceChange: (spaceId: string) => void;
  onSettingsClick: () => void;
  onHelpClick: (event: React.MouseEvent) => void;
  helpMenuOpen: boolean;
}

export function SidebarFooter({
  spaces,
  activeSpaceId,
  onSpaceChange,
  onSettingsClick,
  onHelpClick,
  helpMenuOpen,
}: SidebarFooterProps) {

  useKeyboardShortcut("app.openSettings", onSettingsClick, {
    allowInEditable: true,
  });
  const settingsShortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.openSettings"),
  );

  return (
    <div
      className="px-2 py-2 space-y-3"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-3"

              style={{
          animation: `slide-from-bottom 0.2s ease-out 0.1s both`,
        }}>
        <div className=" rounded-full p-1.5">
          <Button
            onClick={onSettingsClick}
            className="shrink-0 flex items-center justify-center transition-transform duration-300 cursor-pointer"
            aria-label="Settings"
            title="Settings"
            tooltipShortcut={settingsShortcut}
            tooltip="Open Settings"
            tooltipPosition="top-right"
          >
            <Settings className="size-4.5 text-primary-900 dark:text-primary-100 hover:text-primary-950 dark:hover:text-primary-100 transition-colors duration-300" />
          </Button>
        </div>
          <div className="">
            <SpaceSelector
              spaces={spaces}
              activeSpaceId={activeSpaceId}
              onSpaceChange={onSpaceChange}
            />
          </div>
        <div className=" rounded-full p-1.5">
          <Button
            tooltip="Help & Resources"
            tooltipPosition="top"
            onClick={onHelpClick}
            aria-haspopup="menu"
            aria-expanded={helpMenuOpen}
            className="shrink-0 flex items-center justify-center transition-transform duration-300 cursor-pointer"
            aria-label="Help & Resources"
            title="Help & Resources"
          >
            <Question className="size-4  text-primary-900 dark:text-primary-100 hover:text-primary-950 dark:hover:text-primary-100 transition-colors duration-300" />
          </Button>
        </div>
      </div>
    </div>
  );
}
