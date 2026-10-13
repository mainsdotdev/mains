import { useId, useRef, useState } from "react";
import { ShellHeader } from "@/components/layout/shell-header";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { TabStrip, Text, toast } from "@/components/ui";
import { Document } from "@/components/ui/icons";
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
} from "@/lib/layout";
import { isTextDocType } from "@/lib/document-viewer";
import { BaseTab } from "./base-tab";
import { DocumentRenderHost } from "./document-viewer/document-render-host";
import { MarkdownDocument } from "./document-viewer/markdown-document";
import { PdfDocument } from "./document-viewer/pdf-document";
import { DocumentViewerToolbar } from "./document-viewer/document-viewer-toolbar";

export function DocumentViewerPanel({ reserveLayoutControls = false }: { reserveLayoutControls?: boolean }) {
  const { isOpen, currentDoc, close } = useDocumentViewer();
  const dispatch = useAppDispatch();
  const documentViewerWidth = useAppSelector((s) => s.appSettings.documentViewerWidth);
  const [zoom, setZoom] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const tabId = useId();
  const contentId = `${tabId}-content`;

  // Reset zoom to 100% when a different document loads. Adjusting state during
  // render (React's supported pattern) instead of in an effect avoids a wasted
  // commit + re-render.
  const prevPathRef = useRef(currentDoc?.path);
  if (currentDoc?.path !== prevPathRef.current) {
    prevPathRef.current = currentDoc?.path;
    if (zoom !== 1) setZoom(1);
  }

  const { isVisible, isAnimatedIn } = usePanelAnimation(isOpen);

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

  const DocIcon = currentDoc ? DOC_TYPE_ICONS[currentDoc.docType] : Document;
  const title = currentDoc?.fileName ?? "Document";

  return (
    <div
      data-document-viewer-panel=""
      className="fixed inset-y-0 right-0 z-9999 overflow-hidden transition-[transform,opacity] duration-150 ease-out"
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

      {/* Keep the full lane width for resizing while the inset surface leaves
          the translucent app frame visible on every side. */}
      <div className="absolute inset-1.25 flex min-h-0 flex-col overflow-hidden">
        <ShellHeader reserveWindowControls={reserveLayoutControls}>
          <TabStrip activeKey={currentDoc?.path} role="tablist" aria-label="Document tabs">
            <BaseTab id={tabId} ariaControls={contentId} isActive isFirst showLeadingCorner={false}
              role="tab" ariaLabel={title} icon={<DocIcon className="size-3.5" />} label={title} tooltip={title}
              onClick={() => {}} closeLabel="Close document viewer"
              onClose={(event) => { event.stopPropagation(); close(); }} />
          </TabStrip>
        </ShellHeader>
        <div id={contentId} role="tabpanel" aria-labelledby={tabId} data-document-viewer-content=""
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl rounded-tl-none bg-primary dark:bg-primary-950">
          <DocumentViewerToolbar doc={currentDoc} zoom={zoom} onZoomChange={setZoom}
            isSaving={isSaving} onSaveCopy={() => void saveCopy()} />

          {/* Body — text formats render as React, PDFs as pdf.js canvases, Office
              bytes go to the shadow host. They never mix, so the branch lives here
              rather than inside the host. */}
          {currentDoc ? (
            isTextDocType(currentDoc.docType) ? (
              <MarkdownDocument key={currentDoc.path} path={currentDoc.path} docType={currentDoc.docType} />
            ) : currentDoc.docType === "pdf" ? (
              <PdfDocument key={currentDoc.path} doc={currentDoc} zoom={zoom} />
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
      </div>
    </div>
  );
}
