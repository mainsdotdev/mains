import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useAppDispatch } from "@/lib/redux/hooks";
import type { DocumentViewerDoc } from "@/lib/redux/slices/appSettingsSlice";
import { openPreviewTab } from "@/lib/redux/slices/previewSlice";
import { usePreviewPanel } from "./use-preview-panel";

interface DocumentViewerContextValue {
  isOpen: boolean;
  currentDoc: DocumentViewerDoc | null;
  open: (doc: DocumentViewerDoc) => void;
  close: () => void;
}
const Context = createContext<DocumentViewerContextValue | null>(null);

export function DocumentViewerProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const preview = usePreviewPanel();
  const { ownerKey, reveal, hide } = preview;
  const open = useCallback((doc: DocumentViewerDoc) => {
    reveal();
    dispatch(openPreviewTab({ ownerKey, tab: { kind: "document", id: `document:${crypto.randomUUID()}`, doc } }));
  }, [dispatch, ownerKey, reveal]);
  const currentDoc = preview.activeTab?.kind === "document" ? preview.activeTab.doc : null;
  const isOpen = preview.isOpen && !!currentDoc;
  const value = useMemo(() => ({ isOpen, currentDoc, open, close: hide }), [isOpen, currentDoc, open, hide]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDocumentViewer(): DocumentViewerContextValue {
  return useContext(Context) ?? { isOpen: false, currentDoc: null, open: () => {}, close: () => {} };
}
