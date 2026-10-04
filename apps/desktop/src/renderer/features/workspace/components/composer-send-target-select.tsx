import { useEffect, useId, useRef, useState } from "react";
import { Button, DropdownWrapper } from "@/components/ui";
import { ArrowUp, Chat, Check, Plus } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import type { ComposerSendTarget } from "../lib/composer-send-target";

export function ComposerSendTargetSelect({ target, onChange, variant = "chip" }: {
  target: ComposerSendTarget;
  onChange?: (runId: string | null) => void;
  variant?: "chip" | "title";
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleAnchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  useClickOutside(menu, close, trigger);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open]);

  return <div ref={titleAnchor} className={variant === "title" ? "min-w-0 flex-1" : "relative min-w-0 max-w-full"}>
    <Button ref={trigger} type="button" onClick={() => setOpen(!open)}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      title="Choose which chat this message is sent to"
      className={variant === "title"
        ? "flex max-w-full items-center gap-2 rounded-lg px-1.5 py-1 text-s font-medium text-primary-900 hover:bg-primary-200/40 dark:text-primary-100 dark:hover:bg-primary/5"
        : "glass-button flex max-w-full items-center gap-1.5 rounded-full py-1 pl-2 pr-1.5 text-xs text-primary-700 dark:text-primary-300"}>
      {variant === "chip" && (target.runId ? <Chat className="size-3 shrink-0" /> : <Plus className="size-3 shrink-0" />)}
      <span className={variant === "title" ? "min-w-0 truncate" : "max-w-60 truncate"}>{target.label}</span>
      {variant === "title" && <ArrowUp className={`size-3.5 shrink-0 text-primary-500 transition-transform rotate-180`} />}
    </Button>
    <DropdownWrapper id={id} isOpen={open} aria-label="Send message to" usePortal
      className={variant === "title" ? "z-(--z-modal-critical) max-w-80" : "max-w-80"}
      triggerRef={variant === "title" ? titleAnchor : trigger} dropdownRef={menu} position={variant === "title" ? "left" : "right"} openUpward={variant === "chip"}
      animationDirection={variant === "title" ? "down" : "up"}
      matchTriggerWidth={variant === "title"} minWidth={variant === "title" ? "min-w-0" : "min-w-60"}>
      <div className="max-h-64 overflow-auto noscrollbar ">
        {target.options.map((option) => {
          const selected = option.runId === target.runId;
          return <Button key={option.runId ?? "new"} type="button" role="menuitemradio" aria-checked={selected}
            onClick={() => { close(); onChange?.(option.runId); trigger.current?.focus(); }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${selected
              ? "bg-primary-200/60 text-primary-950 dark:bg-primary-200/10 dark:text-primary"
              : "text-primary-700 hover:bg-primary-200/30 dark:text-primary-300 dark:hover:bg-primary-800"}`}>
            {option.runId ? <Chat className="size-3.5 shrink-0" /> : <Plus className="size-3.5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
            {selected && <Check className="size-3.5 shrink-0" />}
          </Button>;
        })}
      </div>
    </DropdownWrapper>
  </div>;
}
