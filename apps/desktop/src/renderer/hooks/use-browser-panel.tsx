import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isElectron } from "@/lib/platform";
import type { BrowserChatContext } from "../../shared/browser-chat-window";
import type { FloatingChatMode } from "../../shared/floating-chat";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { usePreviewPanel } from "./use-preview-panel";
import { syncBrowserPreviewTabs } from "@/lib/redux/slices/previewSlice";
import { browserPreviewTab } from "@/features/workspace/lib/preview-tabs";
import { toast } from "@/components/ui";

interface BrowserPanelContextValue {
  isOpen: boolean;
  isExpanded: boolean;
  canExpand: boolean;
  chatMode: FloatingChatMode;
  chatVisible: boolean;
  chatHost: HTMLDivElement | null;
  nativeOverlay: boolean;
  ownerKey: string;
  tabOwnerKey: string;
  composerDirectories?: string[];
  open: () => void;
  newTab: () => Promise<void>;
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
  const preview = usePreviewPanel();
  const conversationOwnerKey = useAppSelector((state) => state.workspace.composerContextKey);
  const { ownerKey, reveal, select, hide, toggleExpanded, canExpand, workspaceScoped } = preview;
  const isOpen = preview.isOpen && preview.activeTab?.kind === "browser";
  const isExpanded = isOpen && preview.isExpanded;
  const [chatMode, setChatMode] = useState<FloatingChatMode>("input");
  const [chatVisible, setChatVisible] = useState(true);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);
  const browserTabs = preview.group.tabs.filter((tab) => tab.kind === "browser");
  const rememberedId = browserTabs[0]?.id;
  const visibleOwner = useRef(ownerKey);
  useLayoutEffect(() => { visibleOwner.current = ownerKey; }, [ownerKey]);

  useEffect(() => {
    // Carry legacy per-chat browser tabs into this Code workspace once that
    // conversation is visited. Work/Chat keep their existing native owner.
    if (ownerKey === conversationOwnerKey || !workspaceScoped) return;
    const api = window.api?.browser;
    if (!api?.reassignTabs) return;
    void api.reassignTabs(conversationOwnerKey, ownerKey).then((response) => {
      if (response.success && response.data.ownerKey === ownerKey) dispatch(syncBrowserPreviewTabs({
        ownerKey, tabs: response.data.tabs.map(browserPreviewTab), activeTabId: response.data.activeTabId,
      }));
    }).catch((error) => console.error("Failed to migrate browser tabs:", error));
  }, [conversationOwnerKey, ownerKey, workspaceScoped, dispatch]);

  const create = useCallback(async (url?: string, filePath?: string) => {
    const api = window.api?.browser;
    if (!api?.createTab) throw new Error("In-app browser is unavailable");
    reveal();
    const context = await api.setContext(ownerKey);
    if (!context.success) throw new Error(context.error);
    if (visibleOwner.current !== ownerKey) return;
    const response = filePath ? await api.createHtmlPreviewTab(filePath, ownerKey) : await api.createTab(url, ownerKey);
    if (!response.success) throw new Error(response.error);
    const state = response.data;
    dispatch(syncBrowserPreviewTabs({ ownerKey, tabs: state.tabs.map(browserPreviewTab), activeTabId: state.activeTabId, activate: true }));
    if (visibleOwner.current !== ownerKey) await api.setContext(visibleOwner.current);
  }, [dispatch, ownerKey, reveal]);
  const newTab = useCallback(() => create(), [create]);
  const open = useCallback(() => {
    if (rememberedId) select(rememberedId);
    else void create().catch((error) => toast.error(error.message));
  }, [rememberedId, select, create]);
  const openUrl = useCallback((url: string) => create(url), [create]);
  const openHtmlFile = useCallback((filePath: string) => create(undefined, filePath), [create]);
  const close = hide;
  const toggle = useCallback(() => { if (isOpen) hide(); else open(); }, [isOpen, hide, open]);

  const value = useMemo(
    () => ({
      isOpen,
      isExpanded,
      canExpand,
      chatMode,
      chatVisible,
      chatHost,
      nativeOverlay: isElectron,
      ownerKey: conversationOwnerKey,
      tabOwnerKey: ownerKey,
      open,
      newTab,
      openUrl,
      openHtmlFile,
      close,
      toggle,
      toggleExpanded,
      setChatMode,
      setChatVisible,
      setChatHost,
    }),
    [isOpen, isExpanded, canExpand, chatMode, chatVisible, chatHost, ownerKey, conversationOwnerKey, open, newTab, openUrl, openHtmlFile, close, toggle, toggleExpanded],
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
      tabOwnerKey: "default",
      open: () => {},
      newTab: async () => {},
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
    tabOwnerKey: context.ownerKey,
    composerDirectories: context.additionalDirectories,
    open: () => {},
    newTab: async () => {},
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
