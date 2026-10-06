import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { isAtlasRoute, shouldHideRightPanel } from "@/lib/layout";
import { isElectron } from "@/lib/platform";
import type { BrowserChatContext } from "../../shared/browser-chat-window";
import type { FloatingChatMode } from "../../shared/floating-chat";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setBrowserPanelOpen,
  setBrowserPanelExpanded,
  setDocumentViewerDoc,
  setDocumentViewerOpen,
  setRightPanelOpen,
  setSessionPanelOpen,
} from "@/lib/redux/slices/appSettingsSlice";

interface BrowserPanelContextValue {
  isOpen: boolean;
  isExpanded: boolean;
  canExpand: boolean;
  chatMode: FloatingChatMode;
  chatVisible: boolean;
  chatHost: HTMLDivElement | null;
  nativeOverlay: boolean;
  ownerKey: string;
  composerDirectories?: string[];
  open: () => void;
  openUrl: (url: string) => Promise<void>;
  openHtmlFile: (filePath: string) => Promise<void>;
  close: () => void;
  toggle: () => void;
  toggleExpanded: () => void;
  setChatMode: (mode: FloatingChatMode) => void;
  setChatVisible: (visible: boolean) => void;
  setChatHost: (node: HTMLDivElement | null) => void;
}

const BrowserPanelContext = createContext<BrowserPanelContextValue | null>(null);

export function BrowserPanelProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const persistedOpen = useAppSelector((state) => state.appSettings.browserPanelOpen);
  const expanded = useAppSelector((state) => state.appSettings.browserPanelExpanded);
  const ownerKey = useAppSelector((state) => state.workspace.composerContextKey);
  const ownerReady = useAppSelector((state) => state.workspace.composerContextReady);
  const { pathname } = useLocation();
  const isOpen = persistedOpen && ownerReady && !shouldHideRightPanel(pathname);
  const canExpand = !isAtlasRoute(pathname);
  const [chatMode, setChatMode] = useState<FloatingChatMode>("input");
  const [chatVisible, setChatVisible] = useState(true);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);

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
  const openHtmlFile = useCallback(async (filePath: string) => {
    const api = window.api?.browser;
    if (!api?.createHtmlPreviewTab) throw new Error("HTML preview is unavailable");

    open();
    const contextResponse = await api.setContext(ownerKey);
    if (contextResponse?.success === false) {
      throw new Error(contextResponse.error || "Failed to open browser tabs");
    }
    const response = await api.createHtmlPreviewTab(filePath, ownerKey);
    if (response?.success === false) {
      throw new Error(response.error || "Failed to open HTML preview");
    }
  }, [open, ownerKey]);
  const close = useCallback(() => {
    dispatch(setBrowserPanelOpen(false));
  }, [dispatch]);
  const toggle = useCallback(() => {
    if (!persistedOpen) dispatch(setSessionPanelOpen(false));
    dispatch(setBrowserPanelOpen(!persistedOpen));
  }, [dispatch, persistedOpen]);
  const toggleExpanded = useCallback(() => {
    if (!canExpand) return;
    if (!expanded) {
      setChatMode("input");
      setChatVisible(true);
    }
    dispatch(setBrowserPanelExpanded(!expanded));
  }, [dispatch, expanded, canExpand]);

  const value = useMemo(
    () => ({
      isOpen,
      isExpanded: isOpen && expanded && canExpand,
      canExpand,
      chatMode,
      chatVisible,
      chatHost,
      nativeOverlay: isElectron,
      ownerKey,
      open,
      openUrl,
      openHtmlFile,
      close,
      toggle,
      toggleExpanded,
      setChatMode,
      setChatVisible,
      setChatHost,
    }),
    [isOpen, expanded, canExpand, chatMode, chatVisible, chatHost, ownerKey, open, openUrl, openHtmlFile, close, toggle, toggleExpanded],
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
      isExpanded: false,
      canExpand: false,
      chatMode: "input",
      chatVisible: false,
      chatHost: null,
      nativeOverlay: false,
      ownerKey: "default",
      open: () => {},
      openUrl: async () => {},
      openHtmlFile: async () => {},
      close: () => {},
      toggle: () => {},
      toggleExpanded: () => {},
      setChatMode: () => {},
      setChatVisible: () => {},
      setChatHost: () => {},
    };
  }
  return ctx;
}

/** The floating native window reuses the regular workspace chat in its own renderer. */
export function BrowserChatWindowProvider({
  context,
  children,
}: {
  context: BrowserChatContext;
  children: ReactNode;
}) {
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);
  const setChatMode = useCallback((next: FloatingChatMode) => {
    void window.api.browserChat.postAction({ type: "mode", mode: next });
  }, []);
  const value = useMemo<BrowserPanelContextValue>(() => ({
    isOpen: true,
    isExpanded: true,
    canExpand: true,
    chatMode: context.mode,
    chatVisible: true,
    chatHost,
    nativeOverlay: true,
    ownerKey: context.ownerKey,
    composerDirectories: context.additionalDirectories,
    open: () => {},
    openUrl: async () => {},
    openHtmlFile: async () => {},
    close: () => {},
    toggle: () => {},
    toggleExpanded: () => {},
    setChatMode,
    setChatVisible: () => {},
    setChatHost,
  }), [chatHost, context.ownerKey, context.mode, context.additionalDirectories, setChatMode]);
  return <BrowserPanelContext.Provider value={value}>{children}</BrowserPanelContext.Provider>;
}
