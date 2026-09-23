import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { shouldHideRightPanel } from "@/lib/layout";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setBrowserPanelOpen,
  setDocumentViewerDoc,
  setDocumentViewerOpen,
  setRightPanelOpen,
  setSessionPanelOpen,
} from "@/lib/redux/slices/appSettingsSlice";

interface BrowserPanelContextValue {
  isOpen: boolean;
  ownerKey: string;
  open: () => void;
  openUrl: (url: string) => Promise<void>;
  close: () => void;
  toggle: () => void;
}

const BrowserPanelContext = createContext<BrowserPanelContextValue | null>(null);

export function BrowserPanelProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const persistedOpen = useAppSelector((state) => state.appSettings.browserPanelOpen);
  const ownerKey = useAppSelector((state) => state.workspace.composerContextKey);
  const ownerReady = useAppSelector((state) => state.workspace.composerContextReady);
  const { pathname } = useLocation();
  const isOpen = persistedOpen && ownerReady && !shouldHideRightPanel(pathname);

  // The browser takes over the right edge, which the session box sits against —
  // close every other right-edge owner regardless of where the open originated.
  const open = useCallback(() => {
    dispatch(setRightPanelOpen(false));
    dispatch(setSessionPanelOpen(false));
    dispatch(setDocumentViewerOpen(false));
    dispatch(setDocumentViewerDoc(null));
    dispatch(setBrowserPanelOpen(true));
  }, [dispatch]);
  const openUrl = useCallback(async (url: string) => {
    const api = (window as any).api?.browser;
    if (!api?.createTab) throw new Error("In-app browser is unavailable");

    open();
    if (api.setContext) {
      const contextResponse = await api.setContext(ownerKey);
      if (contextResponse?.success === false) {
        throw new Error(contextResponse.error || "Failed to open browser tabs");
      }
    }
    const response = await api.createTab(url, ownerKey);
    if (response?.success === false) {
      throw new Error(response.error || "Failed to open browser tab");
    }
  }, [open, ownerKey]);
  const close = useCallback(() => dispatch(setBrowserPanelOpen(false)), [dispatch]);
  const toggle = useCallback(() => {
    if (!persistedOpen) dispatch(setSessionPanelOpen(false));
    dispatch(setBrowserPanelOpen(!persistedOpen));
  }, [dispatch, persistedOpen]);

  const value = useMemo(
    () => ({ isOpen, ownerKey, open, openUrl, close, toggle }),
    [isOpen, ownerKey, open, openUrl, close, toggle],
  );

  return (
    <BrowserPanelContext.Provider value={value}>
      {children}
    </BrowserPanelContext.Provider>
  );
}

export function useBrowserPanel(): BrowserPanelContextValue {
  const ctx = useContext(BrowserPanelContext);
  if (!ctx) {
    return {
      isOpen: false,
      ownerKey: "default",
      open: () => {},
      openUrl: async () => {},
      close: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
