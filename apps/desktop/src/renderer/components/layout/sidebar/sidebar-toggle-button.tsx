import { SidebarOpen, SidebarClose } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { useState, useEffect } from "react";
import { useCapabilities } from "@/lib/platform";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";

interface SidebarToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

export function SidebarToggleButton({
  isOpen,
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
      className="fixed z-(--z-panel-toggle) flex h-7 items-center gap-1 transition-all duration-300 ease-out"
      style={{
        top: "calc(0.5875rem + env(safe-area-inset-top))",
        left: reserveTrafficLights ? "5.5rem" : "0.75rem",
      }}
    >
      <div className="rounded-full ">
        <Button
          tooltip={tooltip}
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
    </div>
  );
}
