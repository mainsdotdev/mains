import { Check, Clipboard } from "@/components/ui/icons";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { Button, type ButtonVariant } from "./button";

interface CopyButtonProps {
  text: string;
  tooltip?: string;
  /** Tooltip shown while the post-copy check mark is visible (e.g. "Copied!"). */
  copiedTooltip?: string;
  variant?: ButtonVariant;
  className?: string;
}

export function CopyButton({
  text,
  tooltip = "Copy to clipboard",
  copiedTooltip,
  variant = "icon",
  className = "shrink-0",
}: CopyButtonProps) {
  const { copy, isCopied } = useCopyToClipboard();
  return (
    <Button
      type="button"
      variant={variant}
      tooltip={isCopied && copiedTooltip ? copiedTooltip : tooltip}
      onClick={() => void copy(text)}
      className={className}
    >
      {isCopied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
    </Button>
  );
}
