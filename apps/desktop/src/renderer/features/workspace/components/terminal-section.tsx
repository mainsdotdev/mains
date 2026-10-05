import { lazy, Suspense } from "react";
import { Close, Bash } from "@/components/ui/icons";
import { Body, Button } from "@/components/ui";
import { BOTTOM_TERMINAL_HEIGHT } from "@/lib/layout";

// xterm is only useful after the user opens the terminal. Keeping it behind
// this boundary removes its parser and renderer from normal app startup.
const XtermTerminal = lazy(() =>
  import("./xterm-terminal").then((module) => ({
    default: module.XtermTerminal,
  })),
);

interface TerminalSectionProps {
  id: string;
  rootPath?: string;
  isOpen: boolean;
  title?: string;
  pendingCommand?: string | null;
  onPendingCommandSent?: () => void;
  onClose?: () => void;
}

export function TerminalSection({
  id,
  rootPath,
  isOpen,
  title = "Terminal",
  pendingCommand,
  onPendingCommandSent,
  onClose,
}: TerminalSectionProps) {
  const terminalId = `terminal-${id}`;

  return (
    <div
      className="w-full min-w-0 shrink-0 overflow-hidden transition-[height,padding-top] duration-300 ease-out"
      style={{
        height: isOpen ? BOTTOM_TERMINAL_HEIGHT : "0px",
        paddingTop: isOpen ? "0.3125rem" : "0px",
      }}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-primary dark:bg-primary-950">
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <div className="flex items-center gap-1">
            <Bash className="size-4.5 text-primary-500" />
            <Body size="s" tone="faint" weight="normal">
              {title}
            </Body>
          </div>
          {onClose && (
            <Button
              variant="icon"
              tooltip="Close terminal"
              tooltipPosition="top-left"
              onClick={onClose}
            >
              <Close className="size-4" />
            </Button>
          )}
        </div>
        {isOpen && (
          <div className="min-h-0 flex-1 px-3">
            <Suspense fallback={null}>
              <XtermTerminal
                id={terminalId}
                rootPath={rootPath}
                pendingCommand={pendingCommand}
                onPendingCommandSent={onPendingCommandSent}
              />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
