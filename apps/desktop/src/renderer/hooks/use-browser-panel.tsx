import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  open: () => void;
  openUrl: (url: string) => Promise<void>;
  close: () => void;
  toggle: () => void;
}

const BrowserPanelContext = createContext<BrowserPanelContextValue | null>(null);

export function BrowserPanelProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.appSettings.browserPanelOpen);

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
    const response = await api.createTab(url);
    if (response?.success === false) {
      throw new Error(response.error || "Failed to open browser tab");
    }
  }, [open]);
  const close = useCallback(() => dispatch(setBrowserPanelOpen(false)), [dispatch]);
  const toggle = useCallback(() => {
    if (!isOpen) dispatch(setSessionPanelOpen(false));
    dispatch(setBrowserPanelOpen(!isOpen));
  }, [dispatch, isOpen]);

  // The browser has no place on the routes that hide the right edge (Settings,
  // Plugins, Pulse, Relay, Tasks) — its toggle is hidden there too. The open
  // state is persisted, so it is taken down here rather than by each page.
  const { pathname } = useLocation();
  const hiddenOnRoute = shouldHideRightPanel(pathname);
  useEffect(() => {
    if (hiddenOnRoute && isOpen) close();
  }, [hiddenOnRoute, isOpen, close]);

  const value = useMemo(
    () => ({ isOpen, open, openUrl, close, toggle }),
    [isOpen, open, openUrl, close, toggle],
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
      open: () => {},
      openUrl: async () => {},
      close: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
