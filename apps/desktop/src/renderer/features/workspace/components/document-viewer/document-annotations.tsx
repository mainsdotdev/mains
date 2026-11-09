import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, SegmentedTabs, Textarea, toast } from "@/components/ui";
import { Close } from "@/components/ui/icons";
import type { AnnotatableDocumentType } from "@mains/contracts/document-annotations";
import { documentAnnotationPageLabel } from "@mains/contracts/document-annotations";
import type { DocumentViewerDoc } from "@/lib/redux/slices/appSettingsSlice";
import { addContextItemForKey } from "@/lib/redux/slices/workspaceSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { describeDocumentTarget, documentTargetRects, observeDocumentSelection, type DocumentAnnotationSurface, type DocumentSelectionMode, type DocumentTarget } from "../../lib/document-selection";
import { captureDocumentPage } from "../../lib/document-capture";
import { annotationViewIdentity, createAnnotationCapture, documentIdentity } from "../../lib/document-lifecycle";
import { localDocumentUrlRevision, subscribeLocalDocumentUrls } from "@/lib/local-document-url";

interface Outline { x: number; y: number; width: number; height: number; label: string; selected: boolean }
interface Props { surface: DocumentAnnotationSurface; doc: DocumentViewerDoc; onExit: () => void }

/** All document formats share themed selection chrome outside their rendering surface. */
export function DocumentAnnotations(props: Props) {
  const ownerKey = useAppSelector((state) => state.workspace.composerContextKey);
  const ready = useAppSelector((state) => state.workspace.composerContextReady);
  const revision = useSyncExternalStore(subscribeLocalDocumentUrls, localDocumentUrlRevision);
  const source = documentIdentity(props.doc, revision);
  const key = annotationViewIdentity(ownerKey, source, props.surface);
  return <DocumentAnnotationEditor key={key} {...props} ownerKey={ownerKey} ready={ready} />;
}
function DocumentAnnotationEditor({ surface, doc, onExit, ownerKey, ready }: Props & { ownerKey: string; ready: boolean }) {
  const dispatch = useAppDispatch();
  const layer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<DocumentSelectionMode>("content");
  const [selected, setSelected] = useState<DocumentTarget[]>([]);
  const [hovered, setHovered] = useState<DocumentTarget | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [capture] = useState(createAnnotationCapture);
  useEffect(() => capture.attach(), [capture]);
  const [outlines, setOutlines] = useState<Outline[]>([]);
  const [card, setCard] = useState({ x: 12, y: 12, width: 320 });
  const [hintBottom, setHintBottom] = useState(12);
  const documentType = doc.docType as AnnotatableDocumentType;
  const pageLabel = (pageNumber: number) => documentAnnotationPageLabel({ documentType, pageNumber });

  useEffect(() => {
    if (busy) return;
    return observeDocumentSelection(surface, mode, {
      hover: setHovered,
      select: (target) => {
        setHovered(null);
        setSelected((current) => current.some((item) => item.element.id === target.element.id && item.page === target.page)
          ? current.filter((item) => item.element.id !== target.element.id || item.page !== target.page)
          : current[0]?.page !== target.page ? [target] : [...current, target]);
      },
      invalidRange: () => toast.error("Select text within one page at a time"),
    });
  }, [surface, mode, busy]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const path = event.composedPath();
      const viewer = layer.current?.closest("[data-document-viewer-panel]");
      if (!path.includes(surface.root) && !path.includes(layer.current!) && !(viewer && path.includes(viewer)) && event.target !== document.body) return;
      event.preventDefault(); event.stopPropagation(); onExit();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [surface, onExit]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const host = layer.current;
      if (!host) return;
      const bounds = host.getBoundingClientRect();
      const viewport = surface.viewport.getBoundingClientRect();
      setHintBottom(Math.max(12, bounds.bottom - viewport.bottom + 12));
      const visible = [...selected, ...(hovered && !selected.includes(hovered) ? [hovered] : [])].flatMap((target) => {
        if (!target.page.isConnected || !target.node.isConnected) return [];
        const page = target.page.getBoundingClientRect();
        return documentTargetRects(target).flatMap((rect) => {
          const left = Math.max(page.left + rect.x * page.width, viewport.left);
          const top = Math.max(page.top + rect.y * page.height, viewport.top);
          const right = Math.min(page.left + (rect.x + rect.width) * page.width, viewport.right);
          const bottom = Math.min(page.top + (rect.y + rect.height) * page.height, viewport.bottom);
          if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return [];
          return [{ x: left - bounds.left, y: top - bounds.top, width: right - left, height: bottom - top,
            label: `${documentAnnotationPageLabel({ documentType, pageNumber: target.pageNumber })} · ${target.element.name}`, selected: selected.includes(target) }];
        });
      });
      setOutlines(visible);
      const anchor = [...visible].reverse().find((outline) => outline.selected);
      const width = Math.min(336, Math.max(0, bounds.width - 24));
      setCard({ width, x: Math.max(12, Math.min(anchor?.x ?? 12, bounds.width - width - 12)),
        y: Math.max(48, Math.min(anchor ? (anchor.y + anchor.height + 196 < viewport.bottom - bounds.top
          ? anchor.y + anchor.height + 10 : anchor.y - 186) : 48, viewport.bottom - bounds.top - 186)) });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    surface.viewport.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    if (layer.current) observer.observe(layer.current);
    const page = selected[0]?.page ?? hovered?.page;
    if (page) observer.observe(page);
    const mutations = new MutationObserver(schedule);
    mutations.observe(surface.root, { attributes: true, subtree: true, childList: true, attributeFilter: ["style"] });
    window.addEventListener("resize", schedule); update();
    return () => { observer.disconnect(); mutations.disconnect(); surface.viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule); if (frame) cancelAnimationFrame(frame); };
  }, [surface, selected, hovered, documentType]);
  useEffect(() => { if (selected.length) input.current?.focus({ preventScroll: true }); }, [selected.length]);

  const add = async () => {
    const attempt = capture.begin(ready, selected.length);
    if (!attempt) return;
    setBusy(true);
    const targets = [...selected];
    const text = comment.trim(); const key = ownerKey;
    try {
      const elements = targets.map(describeDocumentTarget);
      const screenshotData = await captureDocumentPage(targets[0].page, elements, documentType);
      dispatch(addContextItemForKey({ key, item: {
        kind: "document", id: crypto.randomUUID(), filePath: doc.path, fileName: doc.fileName, documentType,
        pageNumber: targets[0].pageNumber, elements, comment: text, screenshotData,
      } }));
      if (attempt.visible()) {
        setSelected([]); setComment(""); setHovered(null);
        toast.success("Added document annotation to chat");
      }
    } catch (error) { if (attempt.visible()) toast.error(error instanceof Error ? error.message : "Could not capture this page"); }
    finally { attempt.finish(); if (attempt.visible()) setBusy(false); }
  };
  return <div ref={layer} data-document-annotations="" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
    <div className="pointer-events-auto absolute right-3 top-3 rounded-full bg-primary-50 shadow-lg dark:bg-primary-900">
      <SegmentedTabs<DocumentSelectionMode>
        aria-label="Annotation selection" semantics="radiogroup"
        value={mode} onChange={(value) => { setMode(value); setHovered(null); }}
        options={[
          { value: "content", label: surface.textSelection ? "Select text / items" : "Select items" },
          { value: "region", label: "Select area" },
        ]}
        disabled={busy}
      />
    </div>
    {outlines.map((outline, index) => <div key={index} aria-hidden="true"
      className={`absolute border-2 border-accent ${outline.selected ? "bg-accent/10" : "border-dashed"}`}
      style={{ left: outline.x, top: outline.y, width: outline.width, height: outline.height }}>
      {index === 0 && <span className="absolute -top-6 left-0 max-w-64 truncate rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">{outline.label}</span>}
    </div>)}
    {selected.length > 0 ? <div role="dialog" aria-label="Annotate document" aria-busy={busy}
      className="pointer-events-auto absolute rounded-2xl border border-primary-200 bg-primary-50 p-3 shadow-xl dark:border-primary-700 dark:bg-primary-900"
      style={{ left: card.x, top: card.y, width: card.width }}>
      <div className="mb-2 flex items-center gap-2 text-xs text-primary-500">
        <span className="min-w-0 flex-1 truncate">{pageLabel(selected[0].pageNumber)} · {selected.length} selected {selected.length === 1 ? "item" : "items"}</span>
        <Button variant="icon" iconSize="xs" aria-label="Clear document selection" disabled={busy} onClick={() => setSelected([])}><Close className="size-3" /></Button>
      </div>
      <Textarea ref={input} aria-label="Document annotation comment" placeholder="Describe a change or ask a question…"
        value={comment} onChange={(event) => setComment(event.target.value)} rows={2} maxLength={4000} disabled={busy}
        className="resize-none text-xs" onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void add(); }
        }} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-primary-500">{surface.textSelection ? "Select text or click more items" : "Click more items to include them"}</span>
        <Button type="button" disabled={busy || !ready} onClick={() => void add()}
          className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs text-accent-foreground">
          {busy ? "Adding…" : "Add to chat"}
        </Button>
      </div>
    </div> : <div style={{ bottom: hintBottom }} className="absolute left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-primary-50/95 px-3 py-1.5 text-center text-xs text-primary-600 shadow-lg dark:bg-primary-900/95 dark:text-primary-300">
      {mode === "region" ? "Drag to select an area" : surface.textSelection ? "Select text or click an item" : "Click a text box, image or shape"} · Esc to exit
    </div>}
  </div>;
}
