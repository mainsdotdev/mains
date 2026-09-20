import { RightPanelOpen, RightPanelClose, Terminal, TerminalOpen, Web } from "@/components/ui/icons";
import { Button, toast } from "@/components/ui";
import { useAppSelector } from "@/lib/redux/hooks";
import { useCapabilities } from "@/lib/platform";
import { useModeConfig } from "@/hooks/use-mode-config";
import { SessionPanelTrigger } from "@/features/workspace/components/session-panel";
import { ChatActionsMenu } from "@/features/workspace/components/chat-actions-menu";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";

interface ToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
  terminalOpen?: boolean;
  onTerminalToggle?: () => void;
  browserOpen?: boolean;
  onBrowserToggle?: () => void;
}

export function ToggleButton({
  isOpen,
  onClick,
  terminalOpen,
  onTerminalToggle,
  browserOpen,
  onBrowserToggle,
}: ToggleButtonProps) {
  const activeWorkspaceId = useAppSelector((state) => state.workspace.activeWorkspaceId);
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
      className="fixed z-(--z-panel-toggle) flex items-center transition-[right] duration-300 ease-out"
      style={{
        top: "calc(0.4875rem + env(safe-area-inset-top))",
        right: browserOpen
          ? "calc(var(--browser-panel-width) + 0.75rem)"
          : "0.8125rem",
      }}
    >
      {(showGitActions || showSources) && (
        <SessionPanelTrigger
          showGitActions={showGitActions}
          showSources={showSources}
        />
      )}
      <div className="flex items-center  rounded-full p-0.5">
      {/* Ahead of the layout toggles: it acts on the chat, not on the window,
          and decides for itself whether this mode has one. */}
      <ChatActionsMenu />
      {onBrowserToggle && embeddedBrowser && (
        <Button
          tooltip={browserTooltip}
          tooltipPosition="left"
          onClick={onBrowserToggle}
          className={`p-1.5 transition-all duration-300 ease-out rounded-full cursor-pointer  hover:bg-primary-50 dark:hover:bg-primary/10 ${
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
      {onTerminalToggle && (
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
          {terminalOpen ? <TerminalOpen className="size-4 text-primary-800 dark:text-primary-200" /> : <Terminal className="size-4 text-primary-700 dark:text-primary-300" />}
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
