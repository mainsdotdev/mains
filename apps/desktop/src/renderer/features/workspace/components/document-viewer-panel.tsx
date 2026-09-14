import { useEffect, useReducer, useRef, useState } from "react";
import { Button, Text, toast } from "@/components/ui";
import { Close, Document, Download } from "@/components/ui/icons";
import { appApi } from "@/lib/transport";
import { DOC_TYPE_ICONS } from "./document-viewer/doc-type-icons";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setDocumentViewerPanelWidth } from "@/lib/redux/slices/appSettingsSlice";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { ResizeHandle } from "@/components/layout/resize-handle";
import {
  DOC_VIEWER_PANEL_WIDTH_VAR,
  DOC_VIEWER_PANEL_WIDTH_MIN,
  DOC_VIEWER_PANEL_WIDTH_MAX,
  DOC_VIEWER_PANEL_WIDTH_DEFAULT,
  clamp,
} from "@/lib/layout";
import { DOC_VIEWER_LABELS, isTextDocType } from "@/lib/document-viewer";
import { DocumentRenderHost } from "./document-viewer/document-render-host";
import { MarkdownDocument } from "./document-viewer/markdown-document";

type AnimationState = "closed" | "opening" | "open" | "closing";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

export function DocumentViewerPanel() {
  const { isOpen, currentDoc, close } = useDocumentViewer();
  const dispatch = useAppDispatch();
  const documentViewerWidth = useAppSelector((s) => s.appSettings.documentViewerWidth);
  const [zoom, setZoom] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

  // Reset zoom to 100% when a different document loads. Adjusting state during
  // render (React's supported pattern) instead of in an effect avoids a wasted
  // commit + re-render.
  const prevPathRef = useRef(currentDoc?.path);
  if (currentDoc?.path !== prevPathRef.current) {
    prevPathRef.current = currentDoc?.path;
    if (zoom !== 1) setZoom(1);
  }

  const [animState, dispatchAnim] = useReducer(
    (_: AnimationState, next: AnimationState) => next,
    isOpen ? "open" : "closed",
  );

  useEffect(() => {
    dispatchAnim(isOpen ? "opening" : "closing");
  }, [isOpen]);

  useEffect(() => {
    if (animState === "opening") {
      const t = setTimeout(() => dispatchAnim("open"), 50);
      return () => clearTimeout(t);
    }
    if (animState === "closing") {
      const t = setTimeout(() => dispatchAnim("closed"), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [animState]);

  const isVisible = animState !== "closed";
  const isAnimatedIn = animState === "open";

  if (!isVisible) return null;

  // "Save a copy": the viewer shows a file that lives in a run directory or a
  // workspace, and the user's own copy belongs wherever they say. Main owns the
  // native dialog; cancelling comes back as a null path, which is not an error.
  const saveCopy = async () => {
    if (!currentDoc || isSaving) return;
    setIsSaving(true);
    try {
      const res = await appApi.fileExplorer.saveFileAs(
        currentDoc.path,
        currentDoc.fileName,
      );
      if (!res.success) {
        toast.error(res.error ?? "Failed to save file");
        return;
      }
      if (res.data) toast.success(`Saved to ${res.data}`);
    } catch {
      toast.error("Failed to save file");
    } finally {
      setIsSaving(false);
    }
  };

  const zoomOut = () => setZoom((z) => clamp(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN, ZOOM_MAX));
  const zoomIn = () => setZoom((z) => clamp(+(z + ZOOM_STEP).toFixed(2), ZOOM_MIN, ZOOM_MAX));

  const DocIcon = currentDoc ? DOC_TYPE_ICONS[currentDoc.docType] : Document;

  return (
    <div
      className="fixed top-1.25 bottom-1.25 right-1.25 dark:bg-primary-950 bg-primary rounded-tr-xl z-9999 flex flex-col border-l border-primary-200/70 dark:border-primary-800/50 transition-[transform,opacity] duration-300 ease-out overflow-hidden"
      style={{
        width: "var(--doc-viewer-panel-width)",
        transform: isAnimatedIn ? "translateX(0)" : "translateX(100%)",
        opacity: isAnimatedIn ? 1 : 0,
      }}
      role="complementary"
      aria-label="Document viewer"
    >
      <ResizeHandle
        edge="left"
        value={documentViewerWidth}
        min={DOC_VIEWER_PANEL_WIDTH_MIN}
        max={DOC_VIEWER_PANEL_WIDTH_MAX}
        computeWidth={(clientX) => window.innerWidth - clientX}
        onPreview={(w) => setLayoutWidthVar(DOC_VIEWER_PANEL_WIDTH_VAR, w)}
        onCommit={(w) => dispatch(setDocumentViewerPanelWidth(w))}
        onReset={() => dispatch(setDocumentViewerPanelWidth(DOC_VIEWER_PANEL_WIDTH_DEFAULT))}
        ariaLabel="Resize document panel"
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-primary-200/60 dark:border-primary-800/50">
        <DocIcon className="size-4 shrink-0 " />
        <div className="flex-1 min-w-0">
          <Text as="div" size="xs" tone="default" weight="medium" className="truncate">
            {currentDoc?.fileName ?? "Document"}
          </Text>
          {currentDoc && (
            <Text as="div" size="t" tone="subtle" className="-mt-px">
              {DOC_VIEWER_LABELS[currentDoc.docType]}
            </Text>
          )}
        </div>

        {/* Zoom controls — rendered documents only. Text sets its own type
            from the app's scale, so there is nothing here to scale. */}
        {currentDoc && !isTextDocType(currentDoc.docType) && (
          <Text as="div" size="inherit" tone="muted" className="flex items-center gap-0.5">
            <Button
              tooltip="Zoom out"
              tooltipPosition="bottom"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              className="size-6 flex items-center justify-center rounded-md cursor-pointer disabled:opacity-40 hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
              aria-label="Zoom out"
            >
              <Text as="span" size="sm" tone="inherit" className="leading-none">−</Text>
            </Button>
            <Button
              tooltip="Reset zoom"
              tooltipPosition="bottom"
              onClick={() => setZoom(1)}
              className="min-w-10 px-1 text-xxs tabular-nums rounded-md cursor-pointer hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
              aria-label="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              tooltip="Zoom in"
              tooltipPosition="bottom"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              className="size-6 flex items-center justify-center rounded-md cursor-pointer disabled:opacity-40 hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
              aria-label="Zoom in"
            >
              <Text as="span" size="sm" tone="inherit" className="leading-none">+</Text>
            </Button>
          </Text>
        )}

        <Button
          tooltip="Save a copy…"
          tooltipPosition="bottom"
          onClick={() => void saveCopy()}
          disabled={!currentDoc || isSaving}
          className="p-1 rounded-full glass-button cursor-pointer text-primary-700 dark:text-primary-300 hover:bg-primary-200/60 dark:hover:bg-primary-800/60 disabled:opacity-40"
          aria-label="Save a copy of this document"
        >
          <Download className="size-4" />
        </Button>

        <Button
          tooltip="Close"
          tooltipPosition="bottom-left"
          onClick={close}
          className="p-1 rounded-full glass-button cursor-pointer text-primary-700 dark:text-primary-300 hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
          aria-label="Close document viewer"
        >
          <Close className="size-4" />
        </Button>
      </div>

      {/* Body — text formats render as React, Office bytes go to the shadow
          host. The two never mix, so the branch lives here rather than inside
          the host. */}
      {currentDoc ? (
        isTextDocType(currentDoc.docType) ? (
          <MarkdownDocument key={currentDoc.path} path={currentDoc.path} />
        ) : (
          <DocumentRenderHost
            doc={{ ...currentDoc, docType: currentDoc.docType }}
            zoom={zoom}
          />
        )
      ) : (
        <Text as="div" size="xs" tone="subtle" className="flex-1 flex items-center justify-center">
          No document selected
        </Text>
      )}
    </div>
  );
}
