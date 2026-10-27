import { useState } from "react";
import { toast } from "@/components/ui";
import { appApi } from "@/lib/transport";
import { useAppSelector } from "@/lib/redux/hooks";
import type { DocumentViewerDoc } from "@/lib/redux/slices/appSettingsSlice";
import { usePreviewPanel } from "@/hooks/use-preview-panel";
import { isTextDocType } from "@/lib/document-viewer";
import { DocumentRenderHost } from "./document-viewer/document-render-host";
import { MarkdownDocument } from "./document-viewer/markdown-document";
import { PdfDocument } from "./document-viewer/pdf-document";
import { DocumentViewerToolbar } from "./document-viewer/document-viewer-toolbar";
import { DocumentFallback } from "./document-viewer/document-fallback";
import { documentPreviewLimit } from "@mains/contracts/output-files";

/** Each file owns its zoom, scroll containers and renderer for its open lifetime. */
export function DocumentViewerPanel() {
  const preview = usePreviewPanel();
  const groups = useAppSelector((state) => state.preview.byOwner);
  return <>{Object.entries(groups).flatMap(([ownerKey, group]) => group.tabs.flatMap((tab) => tab.kind === "document"
    ? [<DocumentPreview key={tab.id} currentDoc={tab.doc}
        active={preview.isOpen && preview.ownerKey === ownerKey && preview.activeTab?.id === tab.id} />] : []))}</>;
}

function DocumentPreview({ currentDoc, active }: { currentDoc: DocumentViewerDoc; active: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
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

  return <div data-document-viewer-panel="" hidden={!active} inert={!active}
    className="absolute inset-0 flex min-h-0 flex-col overflow-hidden" style={{ display: active ? undefined : "none" }}>
    <DocumentViewerToolbar doc={currentDoc} zoom={zoom} onZoomChange={setZoom}
      isSaving={isSaving} onSaveCopy={() => void saveCopy()} />
    {currentDoc.byteSize !== undefined && currentDoc.byteSize > documentPreviewLimit(currentDoc.docType) ? (
      <div className="relative flex-1">
        <DocumentFallback doc={currentDoc} message={`This document exceeds the ${documentPreviewLimit(currentDoc.docType) / (1024 * 1024)} MiB inline preview limit. Save a copy or open it in another app.`} />
      </div>
    ) : isTextDocType(currentDoc.docType) ? (
      <MarkdownDocument path={currentDoc.path} docType={currentDoc.docType} />
    ) : currentDoc.docType === "pdf" ? (
      <PdfDocument doc={currentDoc} zoom={zoom} />
    ) : (
      <DocumentRenderHost doc={{ ...currentDoc, docType: currentDoc.docType }} zoom={zoom} />
    )}
  </div>;
}
