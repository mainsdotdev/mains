import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  RightPanelOpen,
  RightPanelClose,
  Terminal,
  TerminalOpen,
  Web,
} from "@/components/ui/icons";
import { Button, toast } from "@/components/ui";
import { useAppSelector } from "@/lib/redux/hooks";
import { useCapabilities } from "@/lib/platform";
import { useModeConfig } from "@/hooks/use-mode-config";
import { SessionPanelTrigger } from "@/features/workspace/components/session-panel";
import { ChatActionsMenu } from "@/features/workspace/components/chat-actions-menu";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { LAYOUT_TOGGLE_WIDTH_VAR } from "@/lib/layout";
import { PreviewPanelControls } from "@/components/layout/preview-panel-controls";

interface ToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
  terminalOpen?: boolean;
  onTerminalToggle?: () => void;
  browserOpen?: boolean;
  onBrowserToggle?: () => void;
  browserExpanded?: boolean;
  onBrowserExpandToggle?: () => void;
  showChatActions?: boolean;
  /** Right edge of the chat header when the browser shares the workspace. */
  sessionPanelRight?: string;
}

export function ToggleButton({
  isOpen,
  onClick,
  terminalOpen,
  onTerminalToggle,
  browserOpen,
  onBrowserToggle,
  browserExpanded = false,
  onBrowserExpandToggle,
  showChatActions = true,
  sessionPanelRight,
}: ToggleButtonProps) {
  const chatControlsHidden = !!browserOpen && browserExpanded;
  const sessionPanelRelocated = !!sessionPanelRight;
  const [sessionTrigger, setSessionTrigger] = useState({
    relocated: sessionPanelRelocated,
    ready: false,
  });
  // Reset during render so a fresh open cannot paint the previous open's
  // visible state before an effect runs.
  if (sessionTrigger.relocated !== sessionPanelRelocated) {
    setSessionTrigger({ relocated: sessionPanelRelocated, ready: false });
  }
  useEffect(() => {
    if (!sessionPanelRelocated) return;
    // The preview waits 50ms, then slides for 300ms. Leave a short settling
    // gap so the trigger appears after the panel has reached its final edge.
    const timer = window.setTimeout(() => {
      setSessionTrigger({ relocated: true, ready: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [sessionPanelRelocated]);
  const sessionTriggerHidden = sessionPanelRelocated &&
    (!sessionTrigger.ready || sessionTrigger.relocated !== sessionPanelRelocated);

  const controlsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = controlsRef.current;
    if (!node) return;
    const syncWidth = () => setLayoutWidthVar(
      LAYOUT_TOGGLE_WIDTH_VAR,
      node.getBoundingClientRect().width,
    );
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
  const { showGitActions, showSources, showRightPanel } = useModeConfig();
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
      className="fixed z-(--z-panel-toggle) flex items-center"
      style={{
        top: "calc(0.4875rem + env(safe-area-inset-top))",
        right: "0.8125rem",
      }}
    >
      {browserOpen && embeddedBrowser && onBrowserExpandToggle && (
        <PreviewPanelControls
          label="browser"
          isExpanded={browserExpanded}
          onToggleExpanded={onBrowserExpandToggle}
        />
      )}
      {showChatActions && <ChatActionsMenu aboveBrowser={browserOpen} />}

      {!chatControlsHidden && (showGitActions || showSources) && (
        <div
          className={`flex items-center ${sessionPanelRight ? "order-first" : ""}`}
          inert={sessionTriggerHidden}
          style={{
            // Move only the session trigger. Its flow slot keeps the measured
            // browser header gap stable while the other controls stay fixed.
            transform: sessionPanelRight
              ? `translateX(calc(var(${LAYOUT_TOGGLE_WIDTH_VAR}, 0px) - 100% + 0.8125rem - ${sessionPanelRight}))`
              : "translateX(0)",
            // Keep the slot measured while hidden, without a CSS animation
            // that can restart or be suppressed by the startup animation gate.
            visibility: sessionTriggerHidden ? "hidden" : undefined,
            opacity: sessionTriggerHidden ? 0 : 1,
          }}
        >
          <SessionPanelTrigger
            showGitActions={showGitActions}
            showSources={showSources}
          />
        </div>
      )}
      <div className="flex items-center  rounded-full p-0.5">
        {!chatControlsHidden && onTerminalToggle && (
          <Button
            tooltip={terminalTooltip}
            tooltipPosition="left"
            onClick={() => {
              if (!activeWorkspaceId && !terminalOpen) {
                toast.error("Select a workspace first to use the terminal");
                return;
              }
              onTerminalToggle();
            }}
            className={` p-1.5 transition-all duration-300 ease-out
             rounded-full cursor-pointer hover:bg-primary-50 dark:hover:bg-primary/10
           `}
            aria-label={terminalOpen ? "Close terminal" : "Open terminal"}
          >
            {terminalOpen ? (
              <TerminalOpen className="size-4 text-primary-800 dark:text-primary-200" />
            ) : (
              <Terminal className="size-4 text-primary-700 dark:text-primary-300" />
            )}
          </Button>
        )}
        {onBrowserToggle && embeddedBrowser && (
          <Button
            tooltip={browserTooltip}
            tooltipPosition="left"
            onClick={onBrowserToggle}
            className={`p-1.5 transition-all duration-300 ease-out rounded-full cursor-pointer hover:bg-primary-50 dark:hover:bg-primary/10 ${
              browserOpen
                ? "text-primary-800 dark:text-primary-200"
                : "text-primary-700 dark:text-primary-300"
            }`}
            aria-label={browserOpen ? "Close browser" : "Open browser"}
            aria-pressed={browserOpen}
          >
            <Web className="size-3.75" />
          </Button>
        )}
        {showRightPanel && (
          <Button
            tooltip={isOpen ? "Close right panel" : "Open right panel"}
            tooltipPosition="left"
            onClick={onClick}
            className="rounded-full cursor-pointer hover:bg-primary-50 dark:hover:bg-primary/10 p-1.5  transition-all duration-300 ease-out"
            aria-label={isOpen ? "Close right panel" : "Open right panel"}
          >
            {isOpen ? (
              <RightPanelOpen className="size-4 text-primary-800 dark:text-primary-200" />
            ) : (
              <RightPanelClose className="size-4 text-primary-700 dark:text-primary-300" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
