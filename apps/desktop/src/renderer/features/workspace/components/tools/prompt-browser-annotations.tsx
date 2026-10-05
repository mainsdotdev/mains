import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { BrowserAnnotation } from "@mains/contracts/browser-annotations";
import { Button, DropdownWrapper } from "@/components/ui";
import { Asterisk } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import { BrowserAnnotationComment, BrowserAnnotationElements } from "../browser-annotation-details";

/** Sent annotations are immutable, per-message context rather than composer state. */
export function PromptBrowserAnnotations({ annotations }: { annotations: BrowserAnnotation[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(panel, close, trigger);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const summary = `${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`;
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        className=" flex max-w-full glass-card items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs text-primary-800 dark:text-primary-200"
        aria-label={summary}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <Asterisk className="size-3.5 shrink-0 text-primary-500" />{summary}
      </Button>
      <DropdownWrapper
        id={id}
        isOpen={open}
        triggerRef={trigger}
        dropdownRef={panel}
        usePortal
        position="right"
        matchTriggerWidth={false}
        minWidth="min-w-0"
        role="dialog"
        aria-label="Browser annotations"
      >
        <div className="max-h-[min(28rem,65vh)] w-[min(25rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-1">
          {annotations.map((annotation, index) => (
            <article key={annotation.id} className={`p-2 ${index ? "border-t border-primary-200/20 dark:border-primary-700/20" : ""}`}>
              <BrowserAnnotationElements elements={annotation.elements} />
              <BrowserAnnotationComment comment={annotation.comment} />
            </article>
          ))}
        </div>
      </DropdownWrapper>
    </>
  );
}
