import { useEffect } from "react";
import { Button, Text } from "@/components/ui";
import { Document } from "@/components/ui/icons";
import { useLazyGetAppsForFileQuery } from "@/lib/redux/api";
import { DOC_VIEWER_LABELS } from "@/lib/document-viewer";
import type { DocumentViewerDoc } from "@/lib/redux/slices/appSettingsSlice";

/** Shown when a document can't be rendered inline (notably best-effort PPTX).
 * Offers to open it with a native handler app (PowerPoint, Keynote, …). */
export function DocumentFallback({ doc }: { doc: DocumentViewerDoc }) {
  const [fetchApps, { data: handlerApps = [] }] = useLazyGetAppsForFileQuery();

  useEffect(() => {
    void fetchApps(doc.path);
  }, [doc.path, fetchApps]);

  const openWith = (bundleId: string) => {
    void window.api.shell.openFileWithBundle(doc.path, bundleId);
  };

  const label = DOC_VIEWER_LABELS[doc.docType].toLowerCase();

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center bg-primary dark:bg-primary-900">
      <Document className="size-10 text-primary-400" />
      <Text as="div" tone="muted">
        Inline preview isn’t available for this {label}.
      </Text>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
        {handlerApps.slice(0, 3).map((app) => (
          <Button
            key={app.bundleId}
            type="button"
            onClick={() => openWith(app.bundleId)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-primary-800 bg-primary-100 dark:bg-primary-900 dark:text-primary-200 hover:bg-primary-200/70 dark:hover:bg-primary-800/70 transition-colors cursor-pointer"
          >
            {app.icon && (
              <img src={app.icon} alt="" draggable={false} className="size-4 rounded-sm" />
            )}
            Open in {app.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
