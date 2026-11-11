import { useCallback, useEffect, useId, useRef, useState } from "react";
import { documentAnnotationPageLabel, readDocumentAnnotations, type DocumentAnnotation } from "@mains/contracts/document-annotations";
import { Button, DropdownWrapper, Textarea } from "@/components/ui";
import { Asterisk, Check, Close, Edit, Trash } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useComposerContext } from "../hooks/use-composer-context";

/** Shared by editable composer drafts and immutable sent prompts. */
export function DocumentAnnotationsAttachment({ annotations, onUpdate, onRemove }: {
  annotations: readonly (DocumentAnnotation & { screenshotData?: string })[];
  onUpdate?: (id: string, comment: string) => void;
  onRemove?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => { setOpen(false); setEditing(null); }, []);
  if (open && !annotations.length) setOpen(false);
  useClickOutside(panel, close, trigger);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, close]);
  if (!annotations.length) return null;
  const summary = `${annotations.length} document annotation${annotations.length === 1 ? "" : "s"}`;
  return <>
    <div className="glass-input flex max-w-full items-center self-end rounded-xl">
      <Button ref={trigger} type="button" aria-label={summary} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}
        className="flex min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-primary-800 dark:text-primary-200">
        <Asterisk className="size-3.5 shrink-0 text-primary-500" /><span className="truncate">{summary}</span>
      </Button>
      {onRemove && <Button variant="icon" iconSize="xs" aria-label="Remove all document annotations" className="mr-1"
        onClick={() => { annotations.forEach((item) => onRemove(item.id)); close(); }}><Close className="size-3" /></Button>}
    </div>
    <DropdownWrapper id={id} isOpen={open} usePortal position="right" openUpward={!!onUpdate}
      triggerRef={trigger} dropdownRef={panel} className="z-(--z-modal-critical)"
      matchTriggerWidth={false} minWidth="min-w-0" role="dialog" aria-label="Document annotations">
      <div className="max-h-[min(32rem,70vh)] w-[min(25rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-1">
        {annotations.map((annotation, index) => {
          const save = () => { onUpdate?.(annotation.id, draft.trim()); setEditing(null); };
          return <article key={annotation.id} className={`p-3 ${index ? "border-t border-primary-200/30 dark:border-primary-700/30" : ""}`}>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-primary-500" title={annotation.fileName}>{annotation.fileName} · {documentAnnotationPageLabel(annotation)}</span>
              {onUpdate && <Button variant="icon" iconSize="xs" aria-label={`Edit document annotation ${index + 1}`}
                onClick={() => { setEditing(annotation.id); setDraft(annotation.comment); }}><Edit className="size-3.5" /></Button>}
              {onRemove && <Button variant="icon" iconSize="xs" aria-label={`Delete document annotation ${index + 1}`}
                onClick={() => onRemove(annotation.id)}><Trash className="size-3.5" /></Button>}
            </div>
            <div className="flex items-start gap-3">
              {annotation.screenshotData && <img src={`data:image/png;base64,${annotation.screenshotData}`}
                alt={`Selected items on ${documentAnnotationPageLabel(annotation).toLowerCase()}`} className="h-14 w-24 shrink-0 rounded-md object-contain" />}
              <div className="min-w-0 flex-1">
                <ol className="space-y-1.5">
                  {annotation.elements.map((element) => <li key={element.id} className="flex min-w-0 items-center gap-2 text-xs text-primary-600 dark:text-primary-400">
                    <span className="shrink-0 rounded-md border border-primary-200 px-1.5 py-0.5 text-[10px] dark:border-primary-700">{element.type}</span>
                    <span className="min-w-0 truncate" title={element.text || element.name}>{element.text || element.name}</span>
                  </li>)}
                </ol>
                {editing !== annotation.id && <p className="mt-2 whitespace-pre-wrap wrap-break-word text-xs text-primary-900 dark:text-primary-100">{annotation.comment || "No comment"}</p>}
              </div>
            </div>
            {editing === annotation.id && <div className="mt-3">
              <Textarea autoFocus aria-label={`Comment for document annotation ${index + 1}`} rows={2} maxLength={4000}
                value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); save(); }
                }} />
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" className="rounded-lg px-2 text-xs text-primary-500 transition-colors hover:text-primary-900 dark:hover:text-primary-100" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="button" onClick={save} className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs text-accent-foreground"><Check className="size-3" />Save</Button>
              </div>
            </div>}
          </article>;
        })}
      </div>
    </DropdownWrapper>
  </>;
}

export function ComposerDocumentAnnotations() {
  const { documentAnnotations, update, remove } = useComposerContext();
  return <DocumentAnnotationsAttachment annotations={documentAnnotations.flatMap((item) => readDocumentAnnotations([item]).map((annotation) => ({ ...annotation, screenshotData: item.screenshotData })))}
    onUpdate={(id, comment) => { const item = documentAnnotations.find((item) => item.id === id); if (item) update({ ...item, comment }); }}
    onRemove={(id) => { const item = documentAnnotations.find((item) => item.id === id); if (item) remove(item); }} />;
}
