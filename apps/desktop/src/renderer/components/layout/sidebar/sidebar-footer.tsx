import type { CSSProperties } from "react";
import { useEffect } from "react";
import { Settings, Question } from "@/components/ui/icons";
import SpaceSelector from "./space-selector";
import type { Space } from "@/lib/redux/api";
import { Button } from "@/components/ui";

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onSettingsClick();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onSettingsClick]);

  return (
    <div
      className="px-2 py-2 space-y-3"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-3"

              style={{
          animation: `slide-from-bottom 0.2s ease-out 0.1s both`,
        }}>
        <div className="glass-outline rounded-full p-1.5">
          <Button
            onClick={onSettingsClick}
            className="shrink-0 flex items-center justify-center transition-transform duration-300 cursor-pointer"
            aria-label="Settings"
            title="Settings"
            tooltipShortcut="⌘S"
            tooltip="Open Settings"
            tooltipPosition="top-right"
          >
            <Settings className="size-4 text-primary-900 dark:text-primary-100 hover:text-primary-950 dark:hover:text-primary-100 transition-colors duration-300" />
          </Button>
        </div>
          <div className="">
            <SpaceSelector
              spaces={spaces}
              activeSpaceId={activeSpaceId}
              onSpaceChange={onSpaceChange}
            />
          </div>
        <div className="glass-outline rounded-full p-1.5">
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
