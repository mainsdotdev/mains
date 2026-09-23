import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { shouldHideRightPanel } from "@/lib/layout";
import {
  setDocumentViewerOpen,
  setDocumentViewerDoc,
  setBrowserPanelOpen,
  setRightPanelOpen,
  setSessionPanelOpen,
  type DocumentViewerDoc,
} from "@/lib/redux/slices/appSettingsSlice";

interface DocumentViewerContextValue {
  isOpen: boolean;
  currentDoc: DocumentViewerDoc | null;
  open: (doc: DocumentViewerDoc) => void;
  close: () => void;
}

const DocumentViewerContext = createContext<DocumentViewerContextValue | null>(null);

export function DocumentViewerProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const persistedOpen = useAppSelector((state) => state.appSettings.documentViewerOpen);
  const currentDoc = useAppSelector((state) => state.appSettings.documentViewerDoc);
  const { pathname } = useLocation();
  const isOpen = persistedOpen && !shouldHideRightPanel(pathname);

  const open = useCallback(
    (doc: DocumentViewerDoc) => {
      // The doc viewer, browser panel and right panel are mutually exclusive —
      // they all occupy the right edge. Close the others when opening a doc,
      // along with the session box that sits against that edge.
      dispatch(setBrowserPanelOpen(false));
      dispatch(setRightPanelOpen(false));
      dispatch(setSessionPanelOpen(false));
      dispatch(setDocumentViewerDoc(doc));
      dispatch(setDocumentViewerOpen(true));
    },
    [dispatch],
  );

  const close = useCallback(() => {
    dispatch(setDocumentViewerOpen(false));
    // Drop the loaded document so its ArrayBuffer can be GC'd and a reopen
    // starts fresh.
    dispatch(setDocumentViewerDoc(null));
  }, [dispatch]);

  const value = useMemo(
    () => ({ isOpen, currentDoc, open, close }),
    [isOpen, currentDoc, open, close],
  );

  return (
    <DocumentViewerContext.Provider value={value}>
      {children}
    </DocumentViewerContext.Provider>
  );
}

export function useDocumentViewer(): DocumentViewerContextValue {
  const ctx = useContext(DocumentViewerContext);
  if (!ctx) {
    return {
      isOpen: false,
      currentDoc: null,
      open: () => {},
      close: () => {},
    };
  }
  return ctx;
}
