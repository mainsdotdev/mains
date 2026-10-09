import { Button } from "@/components/ui";
import { Chat, Close, Maximize, Minimize } from "@/components/ui/icons";

interface PreviewPanelControlsProps {
  label: string;
  isExpanded: boolean;
  onToggleExpanded?: () => void;
  onClose?: () => void;
  chatVisible?: boolean;
  onToggleChat?: () => void;
  hideChatLabel?: string;
}

/** Browser and app previews share the same controls at the window's top edge. */
export function PreviewPanelControls({
  label,
  isExpanded,
  onToggleExpanded,
  onClose,
  chatVisible,
  onToggleChat,
  hideChatLabel = "Hide chat",
}: PreviewPanelControlsProps) {
  const expandLabel = isExpanded ? `Restore ${label} panel` : `Expand ${label}`;
  const chatLabel = chatVisible ? hideChatLabel : "Show chat";
  return <>
    {isExpanded && onToggleChat && (
      <Button
        variant="icon"
        onClick={onToggleChat}
        tooltip={chatLabel}
        tooltipPosition="bottom-left"
        aria-label={chatLabel}
        aria-pressed={chatVisible}
      >
        <Chat aria-hidden className="size-3.5" />
      </Button>
    )}
    {onToggleExpanded && <Button
      variant="icon"
      onClick={onToggleExpanded}
      tooltip={expandLabel}
      tooltipPosition="bottom-left"
      aria-label={expandLabel}
      aria-pressed={isExpanded}
    >
      {isExpanded ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}
    </Button>}
    {onClose && (
      <Button
        variant="icon"
        onClick={onClose}
        tooltip={`Close ${label}`}
        tooltipPosition="bottom-left"
        aria-label={`Close ${label}`}
      >
        <Close aria-hidden className="size-3.5" />
      </Button>
    )}
  </>;
}
