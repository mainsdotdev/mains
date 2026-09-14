import { RightPanelOpen, RightPanelClose, Terminal, TerminalOpen, Web } from "@/components/ui/icons";
import { Button, toast } from "@/components/ui";
import { useAppSelector } from "@/lib/redux/hooks";
import { useCapabilities } from "@/lib/platform";
import { useModeConfig } from "@/hooks/use-mode-config";
import { SessionPanelTrigger } from "@/features/workspace/components/session-panel";

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
  const { showGitActions, showRightPanel } = useModeConfig();
  return (
    <div
      data-layout-toggle
      className="fixed z-(--z-panel-toggle) flex items-center gap-1.5 transition-[right] duration-300 ease-out"
      style={{
        top: "calc(0.4875rem + env(safe-area-inset-top))",
        right: browserOpen
          ? "calc(var(--browser-panel-width) + 0.75rem)"
          : "0.8125rem",
      }}
    >
      {showGitActions && <SessionPanelTrigger />}
      <div className="flex items-center gap-1.5 glass-outline rounded-full p-0.5">
      {onBrowserToggle && embeddedBrowser && (
        <Button
          tooltip={browserOpen ? "Close browser" : "Open browser"}
          tooltipPosition="left"
          onClick={onBrowserToggle}
          className={`p-1.25 transition-all duration-300 ease-out rounded-full cursor-pointer  hover:bg-primary-50 dark:hover:bg-primary/10 ${
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
          tooltip={terminalOpen ? "Close terminal" : "Open terminal"}
          tooltipPosition="left"
          onClick={() => {
            if (!activeWorkspaceId && !terminalOpen) {
              toast.error("Select a workspace first to use the terminal");
              return;
            }
            onTerminalToggle();
          }}
          className={` p-1.25 transition-all duration-300 ease-out
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
          className="rounded-full cursor-pointer hover:bg-primary-50 dark:hover:bg-primary/10 p-1  transition-all duration-300 ease-out"
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
