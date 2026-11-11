import { Button, Text } from "@/components/ui";
import { Download, RequestEdits } from "@/components/ui/icons";
import { PreviewToolbar } from "@/components/layout/preview-toolbar";
import { isTextDocType } from "@/lib/document-viewer";
import { clamp } from "@/lib/layout";
import type { DocumentViewerDoc } from "@/lib/redux/slices/appSettingsSlice";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

interface DocumentViewerToolbarProps {
  doc: DocumentViewerDoc | null;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  isSaving: boolean;
  onSaveCopy: () => void;
  annotating?: boolean;
  onToggleAnnotating?: () => void;
}

/** Text actions float over the content; rendered pages keep their toolbar. */
export function DocumentViewerToolbar({ doc, zoom, onZoomChange, isSaving, onSaveCopy, annotating, onToggleAnnotating }: DocumentViewerToolbarProps) {
  const changeZoom = (step: number) => onZoomChange(clamp(+(zoom + step).toFixed(2), ZOOM_MIN, ZOOM_MAX));

  return (
    <PreviewToolbar aria-label="Document tools"
      className={doc && isTextDocType(doc.docType) ? "absolute right-2 top-2 z-10 h-auto border-0 bg-transparent p-0 dark:bg-transparent" : undefined}>
      {onToggleAnnotating && <Button onClick={onToggleAnnotating}
        tooltip={annotating ? "Exit edit request mode" : "Request edits"} tooltipPosition="bottom"
        aria-pressed={!!annotating}
        className={`glass-card inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-accent/40 ${annotating
          ? "text-accent"
          : "text-primary-900 dark:text-primary-100"}`}>
        <RequestEdits className="size-4 shrink-0" aria-hidden="true" />
        Request edits
      </Button>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* Text uses the app's type scale; rendered pages have their own zoom. */}
        {doc && !isTextDocType(doc.docType) && (
          <Text as="div" size="inherit" tone="muted" className="glass-card flex h-8 items-center gap-0.5 rounded-full px-0.5">
            <Button variant="icon" iconSize="sm" tooltip="Zoom out" tooltipPosition="bottom"
              onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">
              <Text as="span" size="sm" tone="inherit" className="leading-none">−</Text>
            </Button>
            <Button tooltip="Reset zoom" tooltipPosition="bottom" onClick={() => onZoomChange(1)}
              className="min-w-10 px-1 text-xxs tabular-nums rounded-full cursor-pointer hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
              aria-label="Reset zoom">
              {Math.round(zoom * 100)}%
            </Button>
            <Button variant="icon" iconSize="sm" tooltip="Zoom in" tooltipPosition="bottom"
              onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
              <Text as="span" size="sm" tone="inherit" className="leading-none">+</Text>
            </Button>
          </Text>
        )}
        {/* Composer drafts have a blob URL rather than a file to copy. */}
        {!doc?.path.startsWith("blob:") && (
          <Button variant="icon" tooltip="Save a copy…" tooltipPosition="bottom-left"
            onClick={onSaveCopy} disabled={!doc || isSaving} aria-label="Save a copy of this document"
            className="glass-card rounded-full size-8">
            <Download className="size-4" />
          </Button>
        )}
      </div>
    </PreviewToolbar>
  );
}
