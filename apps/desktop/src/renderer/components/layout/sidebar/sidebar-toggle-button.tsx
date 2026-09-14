import { SidebarOpen, SidebarClose } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { useState, useEffect } from "react";
import { useCapabilities } from "@/lib/platform";
import { SpaceModePicker } from "@/features/workspace/components/space-mode-picker";
import type { ModeId } from "../../../../shared/modes";

interface SidebarToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
  mode?: ModeId;
  /** Active space's provider — the picker narrows its list with it. */
  providerId?: string;
  onModeChange?: (mode: ModeId) => void;
}

export function SidebarToggleButton({
  isOpen,
  onClick,
  mode,
  providerId,
  onModeChange,
}: SidebarToggleButtonProps) {
  const { windowChrome } = useCapabilities();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    return window.api.app.onFullscreenChange(setIsFullscreen);
  }, []);

  // Clear the macOS traffic lights only with native chrome and not fullscreen.
  const reserveTrafficLights = windowChrome && !isFullscreen;

  return (
    <div
      className="fixed z-(--z-panel-toggle) flex h-7 items-center gap-1 transition-all duration-300 ease-out"
      style={{
        top: "calc(0.5875rem + env(safe-area-inset-top))",
        left: reserveTrafficLights ? "5.5rem" : "0.75rem",
      }}
    >
      <div className="rounded-full  glass-outline">
        <Button
          tooltip={isOpen ? "Close sidebar" : "Open sidebar"}
          tooltipPosition="right"
          onClick={onClick}
          className="rounded-full cursor-pointer hover:bg-primary-100/80 dark:hover:bg-primary/10 px-1.75 py-1.5 text-primary-700 dark:text-primary-300 transition-all duration-300 ease-out"
          aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
        >
          {isOpen ? (
            <SidebarOpen className="size-4 text-primary-800 dark:text-primary-200" />
          ) : (
            <SidebarClose className="size-4 text-primary-700 dark:text-primary-300" />
          )}
        </Button>
      </div>
      {mode && onModeChange && (
        <SpaceModePicker
          value={mode}
          providerId={providerId}
          onChange={onModeChange}
        />
      )}
    </div>
  );
}
