import { SidebarOpen, SidebarClose } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { useState, useEffect } from "react";
import { useCapabilities } from "@/lib/platform";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";

interface SidebarToggleButtonProps {
  isOpen: boolean;
  browserExpanded?: boolean;
  onClick: () => void;
}

export function SidebarToggleButton({
  isOpen,
  browserExpanded,
  onClick,
}: SidebarToggleButtonProps) {
  const { windowChrome } = useCapabilities();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const shortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.toggleSidebar"),
  );
  const tooltip = `${isOpen ? "Close" : "Open"} sidebar${
    shortcut ? ` (${shortcut})` : ""
  }`;

  useEffect(() => {
    return window.api.app.onFullscreenChange(setIsFullscreen);
  }, []);

  // Clear the macOS traffic lights only with native chrome and not fullscreen.
  const reserveTrafficLights = windowChrome && !isFullscreen;

  return (
    <div
      className={`fixed flex h-7 items-center gap-1 transition-all duration-300 ease-out ${browserExpanded ? "z-10000" : "z-(--z-panel-toggle)"}`}
      style={{
        top: "calc(0.5875rem + env(safe-area-inset-top))",
        left: reserveTrafficLights ? "5.25rem" : "0.75rem",
      }}
    >
      <div className="rounded-full ">
        <Button
          variant="icon"
          tooltip={tooltip}
          tooltipPosition="right"
          onClick={onClick}
          aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
        >
          {isOpen ? (
            <SidebarOpen className="size-4" />
          ) : (
            <SidebarClose className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
