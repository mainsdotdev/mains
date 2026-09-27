import { Button, Caption, Text } from "@/components/ui";
import { useKeyboardShortcut } from "@/providers/keyboard-shortcuts-provider";

interface NewButtonProps {
  onClick: () => void;
  title: string;
  actionPrefix?: string;
  icon?: React.ReactNode;
  shortcutLabel?: string;
  opensDialog?: boolean;
}

export default function NewButton({
  onClick,
  title,
  icon,
  actionPrefix = "New",
  shortcutLabel,
  opensDialog = false,
}: NewButtonProps) {
  useKeyboardShortcut("app.newItem", onClick, {
    allowInEditable: true,
  });

  return (
    <Button
      tooltip={`${actionPrefix} ${title}`}
      variant="subtle"
      tooltipShortcut={shortcutLabel}
      onClick={onClick}
      aria-haspopup={opensDialog ? "dialog" : undefined}
      fullWidth
      className="justify-start cursor-pointer transition-transform duration-200 px-2 rounded-xl"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {icon}
      {/* Size comes from `Button` (`text-s`); only the weight is overridden. */}
      <Text as="span" size="inherit" weight="normal">
        {actionPrefix} {title}
      </Text>
      {shortcutLabel && <Caption className="ml-auto">{shortcutLabel}</Caption>}
    </Button>
  );
}
