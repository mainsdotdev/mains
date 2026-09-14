import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Button, DropdownMenu, DropdownMenuItem, Text, toast } from "@/components/ui";
import { ArrowUp, Download, Finder, Mains } from "@/components/ui/icons";
import { appApi } from "@/lib/transport";
import { useLazyGetAppsForFileQuery } from "@/lib/redux/api";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { useCapabilities } from "@/lib/platform";
import { DOC_VIEWER_LABELS, type DocType } from "@/lib/document-viewer";
import { DOC_TYPE_ICONS } from "../document-viewer/doc-type-icons";

/** Artifact card for a generated Office document. Mirrors `ImageArtifact` but
 * opens in the in-app document viewer panel instead of an image preview modal. */
export function DocumentArtifact({
  absPath,
  fileName,
  docType,
}: {
  absPath: string;
  fileName: string;
  docType: DocType;
}) {
  const { open } = useDocumentViewer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const [fetchApps, { data: handlerApps = [], isFetching }] = useLazyGetAppsForFileQuery();
  const { revealInFolder } = useCapabilities();

  const ext = fileName.includes(".") ? (fileName.split(".").pop() ?? "").toUpperCase() : "";
  const DocIcon = DOC_TYPE_ICONS[docType];

  useEffect(() => {
    if (menuOpen) void fetchApps(absPath);
  }, [menuOpen, absPath, fetchApps]);

  const openInMains = () => {
    setMenuOpen(false);
    open({ path: absPath, fileName, docType });
  };

  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (openBtnRef.current) {
      const r = openBtnRef.current.getBoundingClientRect();
      const menuWidth = 240;
      setMenuPos({ x: Math.max(8, r.right - menuWidth), y: r.bottom + 6 });
    }
    setMenuOpen(true);
  };

  const openWithBundle = (bundleId: string) => {
    setMenuOpen(false);
    void window.api.shell.openFileWithBundle(absPath, bundleId);
  };

  const showInFinder = () => {
    setMenuOpen(false);
    void window.api.shell.showItemInFolder(absPath);
  };

  // Same action as the viewer panel's save button: main opens the native
  // dialog, a cancelled dialog comes back as a null path and says nothing.
  const saveCopy = async () => {
    setMenuOpen(false);
    try {
      const res = await appApi.fileExplorer.saveFileAs(absPath, fileName);
      if (!res.success) {
        toast.error(res.error ?? "Failed to save file");
        return;
      }
      if (res.data) toast.success(`Saved to ${res.data}`);
    } catch {
      toast.error("Failed to save file");
    }
  };

  return (
    <div
      className="relative flex items-center gap-3 w-full max-w-xl rounded-2xl bg-primary-50 dark:bg-primary-900/85 px-3 py-2.5 shadow-sm"
      title={absPath}
    >
      <Button
        type="button"
        onClick={openInMains}
        className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary-400 overflow-hidden"
        aria-label={`Open ${fileName} in Mains`}
      >
        <div className="size-10 rounded-lg border border-primary-200/60 dark:border-primary-700/20 bg-primary-100/60 dark:bg-primary-900/60 flex items-center justify-center">
          <DocIcon className="size-6" />
        </div>
      </Button>
      <Button
        type="button"
        onClick={openInMains}
        className="flex-1 min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded-md"
      >
        <Text as="div" size="sm" tone="contrast" weight="medium" className="truncate">
          {fileName}
        </Text>
        <Text as="div" size="xs" tone="subtle" className="mt-0.5">
          {DOC_VIEWER_LABELS[docType]}
          {ext ? ` · ${ext}` : ""}
        </Text>
      </Button>
      <Button
        ref={openBtnRef}
        type="button"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-primary-800 dark:text-primary-200 bg-primary-100/80 dark:bg-primary-800/40 hover:bg-primary-200/60 dark:hover:bg-primary-700/35 transition-colors cursor-pointer"
      >
        Open
        <ArrowUp className="size-3.5 rotate-180" />
      </Button>
      <DropdownMenu
        isOpen={menuOpen}
        aria-label="Document actions"
        position={menuPos}
        onClose={() => setMenuOpen(false)}
        minWidth={240}
        origin="top-right"
      >
        <DropdownMenuItem onClick={openInMains}>
          <Mains className="size-4 shrink-0" />
          Open in Mains
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void saveCopy()}>
          <Download className="size-4 shrink-0" />
          Save a copy…
        </DropdownMenuItem>
        {revealInFolder && (
          <DropdownMenuItem onClick={showInFinder}>
            <Finder className="size-4 shrink-0" />
            Show in Finder
          </DropdownMenuItem>
        )}
        {isFetching ? (
          <Text as="div" size="xs" tone="subtle" className="px-3 py-2">
            Loading applications…
          </Text>
        ) : (
          handlerApps.map((app) => (
            <DropdownMenuItem key={app.bundleId} onClick={() => openWithBundle(app.bundleId)}>
              {app.icon ? (
                <img
                  src={app.icon}
                  alt=""
                  draggable={false}
                  className="size-4 shrink-0 rounded-sm"
                />
              ) : null}
              Open with {app.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenu>
    </div>
  );
}
