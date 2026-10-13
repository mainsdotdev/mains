import { SidebarOpen, SidebarClose } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { useShellHeaderChrome } from "@/hooks/use-shell-header-chrome";
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
  const { sidebarToggleLeft } = useShellHeaderChrome();
  const shortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.toggleSidebar"),
  );
  const tooltip = `${isOpen ? "Close" : "Open"} sidebar${
    shortcut ? ` (${shortcut})` : ""
  }`;

  return (
    <div
      className={`fixed flex h-(--shell-header-height) items-center gap-1 transition-all duration-150 ease-out ${browserExpanded ? "z-10000" : "z-(--z-panel-toggle)"}`}
      style={{
        top: "calc(var(--shell-header-top) + env(safe-area-inset-top))",
        left: sidebarToggleLeft,
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
