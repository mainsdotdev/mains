import { useLayoutEffect, useRef } from "react";
import {
  Terminal,
  TerminalOpen,
  Web,
  SidebarClose,
  SidebarOpen,
} from "@/components/ui/icons";
import { Button, toast } from "@/components/ui";
import { useAppSelector } from "@/lib/redux/hooks";
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
  terminalOpen?: boolean;
  onTerminalToggle?: () => void;
  browserOpen?: boolean;
  onBrowserToggle?: () => void;
  showChatActions?: boolean;
  hideTerminalControls?: boolean;
  showRightPanelToggle?: boolean;
}

export function ToggleButton({
  isOpen,
  onClick,
  terminalOpen,
  onTerminalToggle,
  browserOpen,
  onBrowserToggle,
  showChatActions = true,
  hideTerminalControls = false,
  showRightPanelToggle = true,
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

  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );
  const { embeddedBrowser } = useCapabilities();
  const { showRightPanel } = useModeConfig();
  const browserShortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.toggleBrowser"),
  );
  const terminalShortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.toggleTerminal"),
  );
  const browserTooltip = `${browserOpen ? "Close" : "Open"} browser${
    browserShortcut ? ` (${browserShortcut})` : ""
  }`;
  const terminalTooltip = `${terminalOpen ? "Close" : "Open"} terminal${
    terminalShortcut ? ` (${terminalShortcut})` : ""
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
        {!hideTerminalControls && onTerminalToggle && (
          <Button
            variant="icon"
            tooltip={terminalTooltip}
            tooltipPosition="left"
            onClick={() => {
              if (!activeWorkspaceId && !terminalOpen) {
                toast.error("Select a workspace first to use the terminal");
                return;
              }
              onTerminalToggle();
            }}
            className={terminalOpen ? "text-primary-700 dark:text-primary-300" : undefined}
            aria-label={terminalOpen ? "Close terminal" : "Open terminal"}
          >
            {terminalOpen ? (
              <TerminalOpen className="size-4" />
            ) : (
              <Terminal className="size-4" />
            )}
          </Button>
        )}
        {onBrowserToggle && embeddedBrowser && (
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
