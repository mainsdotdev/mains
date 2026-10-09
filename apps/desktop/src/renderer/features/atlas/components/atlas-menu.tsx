import { useId, useState, type ReactNode } from "react";
import { Button, DropdownMenu } from "@/components/ui";

/** The same keyboard-accessible menu for library rows, tiles, Recents and the editor. */
export function AtlasMenu({ label, trigger, children, className = "", disabled = false, side = "bottom" }: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  disabled?: boolean;
  side?: "bottom" | "right";
}) {
  const id = useId();
  const [position, setPosition] = useState<{ x: number; y: number; anchorTop: number } | null>(null);
  const close = () => setPosition(null);
  return <>
    <Button id={id} aria-label={label} aria-haspopup="menu" aria-expanded={!!position} disabled={disabled}
      className={`inline-flex items-center justify-center focus-visible:ring-2 focus-visible:ring-accent/40 ${className}`}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition(position ? null : side === "right"
          ? { x: rect.right, y: rect.bottom, anchorTop: rect.top }
          : { x: rect.right - 200, y: rect.bottom + 6, anchorTop: rect.top - 6 });
      }}>{trigger}</Button>
    <DropdownMenu isOpen={!!position} position={position ?? { x: 0, y: 0 }} onClose={close} aria-labelledby={id} minWidth={200} origin={side === "bottom" ? "right" : "auto"}>
      {children(close)}
    </DropdownMenu>
  </>;
}
