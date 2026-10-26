import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  Web,
  SidebarClose,
  SidebarOpen,
} from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { useCapabilities } from "@/lib/platform";
import { useModeConfig } from "@/hooks/use-mode-config";
import { ChatActionsMenu } from "@/features/workspace/components/chat-actions-menu";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { LAYOUT_TOGGLE_WIDTH_VAR } from "@/lib/layout";

interface ToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
  browserOpen?: boolean;
  onBrowserToggle?: () => void;
  showChatActions?: boolean;
  showRightPanelToggle?: boolean;
  newTabAction?: ReactNode;
}

export function ToggleButton({
  isOpen,
  onClick,
  browserOpen,
  onBrowserToggle,
  showChatActions = true,
  showRightPanelToggle = true,
  newTabAction,
}: ToggleButtonProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = controlsRef.current;
    if (!node) return;
    const syncWidth = () => {
      const width = node.getBoundingClientRect().width;
      setLayoutWidthVar(LAYOUT_TOGGLE_WIDTH_VAR, width);
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(LAYOUT_TOGGLE_WIDTH_VAR);
    };
  }, []);

  const { embeddedBrowser } = useCapabilities();
  const { showRightPanel } = useModeConfig();
  const browserShortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.toggleBrowser"),
  );
  const browserTooltip = `${browserOpen ? "Close" : "Open"} browser${
    browserShortcut ? ` (${browserShortcut})` : ""
  }`;
  return (
    <div
      data-layout-toggle
      ref={controlsRef}
      className="pointer-events-none fixed z-(--z-panel-toggle) flex h-(--shell-header-height) items-center *:pointer-events-auto"
      style={{
        top: "calc(var(--shell-header-top) + env(safe-area-inset-top))",
        right: "0.8125rem",
      }}
    >
      {showChatActions && <ChatActionsMenu aboveBrowser={browserOpen} />}
      <div className="flex items-center rounded-full p-0.5 empty:hidden">
        {newTabAction}
        {!newTabAction && onBrowserToggle && embeddedBrowser && (
          <Button
            variant="icon"
            tooltip={browserTooltip}
            tooltipPosition="left"
            onClick={onBrowserToggle}
            className={browserOpen ? "text-primary-700 dark:text-primary-300" : undefined}
            aria-label={browserOpen ? "Close browser" : "Open browser"}
            aria-pressed={browserOpen}
          >
            <Web className="size-3.75" filled={browserOpen} />
          </Button>
        )}
        {showRightPanelToggle && showRightPanel && (
          <Button
            variant="icon"
            tooltip={isOpen ? "Close right panel" : "Open right panel"}
            tooltipPosition="left"
            onClick={onClick}
            className={isOpen ? "text-primary-700 dark:text-primary-300" : undefined}
            aria-label={isOpen ? "Close right panel" : "Open right panel"}
          >
            {isOpen ? (
              <SidebarOpen className="size-4 rotate-180" />
            ) : (
              <SidebarClose className="size-4 rotate-180" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
