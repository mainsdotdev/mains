import { Button } from "@/components/ui";
import { Chat, Close, Maximize, Minimize } from "@/components/ui/icons";

interface PreviewPanelControlsProps {
  label: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onClose?: () => void;
  chatVisible?: boolean;
  onToggleChat?: () => void;
  hideChatLabel?: string;
  buttonClassName?: string;
}

const controlClassName = "mx-0.5 shrink-0 rounded-full p-1 text-primary-500 hover:bg-primary-200/60 hover:text-primary-900 focus-visible:bg-primary-200/60 dark:hover:bg-primary-800/70 dark:hover:text-primary-100 dark:focus-visible:bg-primary-800/70";

/** Browser and app previews share the same controls at the window's top edge. */
export function PreviewPanelControls({
  label,
  isExpanded,
  onToggleExpanded,
  onClose,
  chatVisible,
  onToggleChat,
  hideChatLabel = "Hide chat",
  buttonClassName,
}: PreviewPanelControlsProps) {
  const expandLabel = isExpanded ? `Restore ${label} panel` : `Expand ${label}`;
  const chatLabel = chatVisible ? hideChatLabel : "Show chat";
  const className = `${controlClassName} ${buttonClassName ?? ""}`;
  return <>
    {isExpanded && onToggleChat && (
      <Button
        onClick={onToggleChat}
        tooltip={chatLabel}
        tooltipPosition="bottom-left"
        aria-label={chatLabel}
        aria-pressed={chatVisible}
        className={className}
      >
        <Chat aria-hidden className="size-3.5" />
      </Button>
    )}
    <Button
      onClick={onToggleExpanded}
      tooltip={expandLabel}
      tooltipPosition="bottom-left"
      aria-label={expandLabel}
      aria-pressed={isExpanded}
      className={className}
    >
      {isExpanded ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}
    </Button>
    {onClose && (
      <Button
        onClick={onClose}
        tooltip={`Close ${label}`}
        tooltipPosition="bottom-left"
        aria-label={`Close ${label}`}
        className={className}
      >
        <Close aria-hidden className="size-3.5" />
      </Button>
    )}
  </>;
}
