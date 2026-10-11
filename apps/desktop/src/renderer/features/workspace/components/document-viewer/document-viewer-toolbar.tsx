import { Button, Text } from "@/components/ui";
import { Download } from "@/components/ui/icons";
import { DOC_VIEWER_LABELS, isTextDocType } from "@/lib/document-viewer";
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
}

/** Document actions sit below the title tab, inside the content surface. */
export function DocumentViewerToolbar({ doc, zoom, onZoomChange, isSaving, onSaveCopy }: DocumentViewerToolbarProps) {
  const changeZoom = (step: number) => onZoomChange(clamp(+(zoom + step).toFixed(2), ZOOM_MIN, ZOOM_MAX));

  return (
    <div role="toolbar" aria-label="Document tools"
      className="flex min-h-9 shrink-0 items-center gap-2 border-b border-primary-200/60 px-2 py-1 dark:border-primary-800/50">
      <Text as="span" size="t" tone="subtle" className="min-w-0 flex-1 truncate">
        {doc ? DOC_VIEWER_LABELS[doc.docType] : "Document"}
      </Text>
      <div className="flex shrink-0 items-center gap-1">
        {/* Text uses the app's type scale; rendered pages have their own zoom. */}
        {doc && !isTextDocType(doc.docType) && (
          <Text as="div" size="inherit" tone="muted" className="flex items-center gap-0.5">
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
            onClick={onSaveCopy} disabled={!doc || isSaving} aria-label="Save a copy of this document">
            <Download className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
