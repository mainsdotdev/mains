import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setBrowserPanelOpen,
  setSessionPanelOpen,
} from "@/lib/redux/slices/appSettingsSlice";

interface BrowserPanelContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const BrowserPanelContext = createContext<BrowserPanelContextValue | null>(null);

export function BrowserPanelProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.appSettings.browserPanelOpen);

  // The browser takes over the right edge, which the session box sits against —
  // it goes away with every path that opens the browser, not just the toolbar.
  const open = useCallback(() => {
    dispatch(setSessionPanelOpen(false));
    dispatch(setBrowserPanelOpen(true));
  }, [dispatch]);
  const close = useCallback(() => dispatch(setBrowserPanelOpen(false)), [dispatch]);
  const toggle = useCallback(() => {
    if (!isOpen) dispatch(setSessionPanelOpen(false));
    dispatch(setBrowserPanelOpen(!isOpen));
  }, [dispatch, isOpen]);

  const value = useMemo(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
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
      close: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
