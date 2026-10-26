import { Button, toast } from "@/components/ui";
import { Terminal, TerminalOpen } from "@/components/ui/icons";
import { useAppSelector } from "@/lib/redux/hooks";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";

/** Lives beside session details so both controls follow the workspace header. */
export function TerminalPanelTrigger({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const workspaceId = useAppSelector((state) => state.workspace.activeWorkspaceId);
  const shortcut = keyboardShortcutLabel(useKeyboardShortcutBinding("app.toggleTerminal"));
  const label = isOpen ? "Hide terminal" : "Open terminal";
  return (
    <Button variant="icon" aria-label={label} tooltip={label} tooltipShortcut={shortcut}
      tooltipPosition="left"
      className={isOpen ? "text-primary-700 dark:text-primary-300" : undefined}
      onClick={() => {
        if (!workspaceId && !isOpen) {
          toast.error("Select a workspace first to use the terminal");
          return;
        }
        onToggle();
      }}>
      {isOpen ? <TerminalOpen className="size-4" /> : <Terminal className="size-4" />}
    </Button>
  );
}
