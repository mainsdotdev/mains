import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { selectSessionRunId } from "@/features/workspace/components/session-panel/select-session-run";
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
  const isOpen = useAppSelector((state) => state.appSettings.documentViewerOpen);
  const currentDoc = useAppSelector((state) => state.appSettings.documentViewerDoc);

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

  // The viewer belongs to the run it was opened from. Leaving that run — a
  // different chat, a different route, Settings — takes the document with it,
  // instead of pinning one conversation's file over the next one. The open
  // state is persisted, so nothing else would ever take it down.
  //
  // Both halves are needed: the tab-less modes change the path when the run
  // changes, developer mode changes only `activeTab`, and Settings changes
  // neither run.
  const location = useLocation();
  const sessionRunId = useAppSelector((state) =>
    selectSessionRunId(state.workspace),
  );
  const context = `${location.pathname}::${sessionRunId ?? ""}`;
  const shownFor = useRef(context);
  useEffect(() => {
    if (shownFor.current === context) return;
    shownFor.current = context;
    if (isOpen) close();
  }, [context, isOpen, close]);

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
