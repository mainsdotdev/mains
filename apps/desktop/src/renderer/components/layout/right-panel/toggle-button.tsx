import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { SessionPanelTrigger } from "@/features/workspace/components/session-panel";
import { ChatActionsMenu } from "@/features/workspace/components/chat-actions-menu";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { LAYOUT_TOGGLE_WIDTH_VAR, LAYOUT_FIXED_CONTROLS_WIDTH_VAR } from "@/lib/layout";
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
  /** Hide chat controls outside the workspace or while an expanded app owns it. */
  hideChatControls?: boolean;
  showRightPanelToggle?: boolean;
  /** Right edge of the chat header when a preview shares the workspace. */
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
  hideChatControls = false,
  showRightPanelToggle = true,
  sessionPanelRight,
}: ToggleButtonProps) {
  const chatControlsHidden = hideChatControls || (!!browserOpen && browserExpanded);
  const sessionPanelRelocated = !!sessionPanelRight;
  const [sessionTrigger, setSessionTrigger] = useState({
    right: sessionPanelRight,
    ready: false,
  });
  // Reset during render so a fresh open cannot paint the previous open's
  // visible state before an effect runs.
  if (sessionTrigger.right !== sessionPanelRight) {
    setSessionTrigger({ right: sessionPanelRight, ready: false });
  }
  useEffect(() => {
    if (!sessionPanelRight) return;
    // The preview waits 50ms, then slides for 300ms. Leave a short settling
    // gap so the trigger appears after the panel has reached its final edge.
    const timer = window.setTimeout(() => {
      setSessionTrigger({ right: sessionPanelRight, ready: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [sessionPanelRight]);
  const sessionTriggerHidden = sessionPanelRelocated &&
    (!sessionTrigger.ready || sessionTrigger.right !== sessionPanelRight);

  const controlsRef = useRef<HTMLDivElement>(null);
  const sessionSlotRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = controlsRef.current;
    if (!node) return;
    const syncWidth = () => {
      const width = node.getBoundingClientRect().width;
      const relocatedWidth = sessionPanelRelocated
        ? sessionSlotRef.current?.getBoundingClientRect().width ?? 0
        : 0;
      setLayoutWidthVar(LAYOUT_TOGGLE_WIDTH_VAR, width);
      setLayoutWidthVar(LAYOUT_FIXED_CONTROLS_WIDTH_VAR, width - relocatedWidth);
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(LAYOUT_TOGGLE_WIDTH_VAR);
      document.documentElement.style.removeProperty(LAYOUT_FIXED_CONTROLS_WIDTH_VAR);
    };
  }, [sessionPanelRelocated]);

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
  // The relocated session leaves a flow slot above the preview's controls.
  // Only the actual children should receive clicks in that area.
  return (
    <div
      data-layout-toggle
      ref={controlsRef}
      className="pointer-events-none fixed z-(--z-panel-toggle) flex items-center *:pointer-events-auto"
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
          ref={sessionSlotRef}
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
