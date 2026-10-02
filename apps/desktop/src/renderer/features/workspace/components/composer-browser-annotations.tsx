import { useEffect, useId, useRef, useState } from "react";
import { Button, DropdownWrapper, Textarea } from "@/components/ui";
import { Chat, Check, Close, Edit, Trash } from "@/components/ui/icons";
import { useComposerContext } from "../hooks/use-composer-context";
import { ImagePreviewModal } from "./image-preview-modal";
import { BrowserAnnotationElements, BrowserAnnotationComment } from "./browser-annotation-details";

const iconButton = "rounded-lg p-0.5 text-primary-500 transition-colors hover:text-primary-900 dark:hover:text-primary-100";

/** One compact attachment opens all comment groups, just like the page editor. */
export function ComposerBrowserAnnotations() {
  const { browserSelections, remove, update } = useComposerContext();
  const annotations = browserSelections.filter((selection) => selection.elements?.length);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const isOpen = open && annotations.length > 0;
  const preview = annotations.find((annotation) => annotation.id === previewId);

  if (open && !annotations.length) setOpen(false);

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node) &&
          !triggerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setEditing(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setEditing(null);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  if (!annotations.length) return null;
  const selectedCount = annotations.reduce((total, annotation) => total + annotation.elements!.length, 0);
  const summary = `${annotations.length} annotation${annotations.length === 1 ? "" : "s"} · ${selectedCount} selected item${selectedCount === 1 ? "" : "s"}`;

  return (
    <>
      <div className="glass-input flex max-w-full shrink-0 items-center self-end rounded-xl animate-blur-reveal">
        <Button
          ref={triggerRef}
          type="button"
          aria-label={summary}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={isOpen ? id : undefined}
          onClick={() => { setOpen(!open); setEditing(null); }}
          className="flex min-w-0 items-center gap-2 rounded-xl py-1.5 pl-3 pr-1.5 text-xs text-primary-800 transition-colors dark:text-primary-200"
        >
          <Chat className="size-3.5 shrink-0 text-primary-500" />
          <span className="truncate">{summary}</span>
        </Button>
        <Button
          type="button"
          aria-label="Remove all annotations"
          onClick={() => { annotations.forEach(remove); setOpen(false); setEditing(null); }}
          className={`${iconButton} mr-1 shrink-0 rounded-full`}
        >
          <Close className="size-3" />
        </Button>
      </div>

      <DropdownWrapper
        id={id}
        isOpen={isOpen}
        usePortal
        openUpward
        triggerRef={triggerRef}
        dropdownRef={panelRef}
        matchTriggerWidth={false}
        minWidth="min-w-0"
        role="dialog"
        aria-label="Browser annotations"
      >
        <div className="max-h-[min(28rem,65vh)] w-[min(25rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-1">
          {annotations.map((annotation, index) => {
            const src = annotation.screenshotCaptureName
              ? `mains-capture://cap/${encodeURIComponent(annotation.screenshotCaptureName)}`
              : undefined;
            const save = () => {
              update({ ...annotation, comment: draft.trim() });
              setEditing(null);
            };
            return (
              <article key={annotation.id} className={`p-2 ${index ? "border-t border-primary-200/20 dark:border-primary-700/20" : ""}`}>
                <div className="mb-2 flex items-center gap-2">
                  {src && (
                    <Button
                      type="button"
                      aria-label={`Preview annotation ${index + 1}`}
                      onClick={() => { setPreviewId(annotation.id); setOpen(false); setEditing(null); }}
                      className="h-7 w-10 shrink-0 overflow-hidden rounded-lg border border-primary-200 dark:border-primary-700/40"
                    >
                      <img src={src} alt="Selected browser elements" className="size-full object-cover" draggable={false} />
                    </Button>
                  )}
                  <span className="min-w-0 flex-1 text-xs text-primary-500">
                    {annotation.elements!.length} selected item{annotation.elements!.length === 1 ? "" : "s"}
                  </span>
                  <Button
                    type="button"
                    aria-label={`Edit annotation ${index + 1}`}
                    onClick={() => { setDraft(annotation.comment || ""); setEditing(annotation.id); }}
                    className={iconButton}
                  >
                    <Edit className="size-3.5" />
                  </Button>
                  <Button type="button" aria-label={`Delete annotation ${index + 1}`} onClick={() => remove(annotation)} className={iconButton}>
                    <Trash className="size-3.5" />
                  </Button>
                </div>
                <BrowserAnnotationElements elements={annotation.elements!} />
                {editing === annotation.id ? (
                  <div className="mt-3">
                    <Textarea
                      autoFocus
                      aria-label={`Comment for annotation ${index + 1}`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={4000}
                      rows={2}
                      placeholder="Add a comment…"
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault(); save();
                        }
                      }}
                      className="text-xs"
                    />
                    <div className="mt-2 flex justify-end gap-1.5">
                      <Button type="button" onClick={() => setEditing(null)} className={`${iconButton} px-2 text-xs`}>Cancel</Button>
                      <Button type="button" aria-label="Save comment" onClick={save} className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs text-accent-foreground">
                        <Check className="size-3" />Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <BrowserAnnotationComment comment={annotation.comment} />
                )}
              </article>
            );
          })}
        </div>
      </DropdownWrapper>
      {preview?.screenshotCaptureName && (
        <ImagePreviewModal
          name={preview.title || "Browser annotation"}
          src={`mains-capture://cap/${encodeURIComponent(preview.screenshotCaptureName)}`}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}
