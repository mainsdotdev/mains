import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { addContextItem } from "@/lib/redux/slices/workspaceSlice";
import type { ContextBrowserSelection } from "@/features/workspace/lib/composer-context";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  Input,
  Text,
  toast,
} from "@/components/ui";
import {
  ChevronLeft,
  Clock,
  Close,
  Crop,
  DeviceMobile,
  Document,
  Download,
  Minus,
  Option,
  Picture,
  Plus,
  Refresh,
  Search,
  Trash,
  View,
} from "@/components/ui/icons";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setBrowserPanelWidth } from "@/lib/redux/slices/appSettingsSlice";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import { ResizeHandle } from "@/components/layout/resize-handle";
import {
  BROWSER_PANEL_WIDTH_VAR,
  BROWSER_PANEL_WIDTH_MIN,
  BROWSER_PANEL_WIDTH_MAX,
  BROWSER_PANEL_WIDTH_DEFAULT,
} from "@/lib/layout";
import {
  BrowserTabStrip,
  type BrowserDeviceEmulationViewModel,
  type BrowserTabViewModel,
} from "./browser-tab-strip";
import { BrowserDeviceToolbar } from "./browser-device-toolbar";
import { BrowserDeviceStage } from "./browser-device-stage";
import { BrowserFindBar } from "./browser-find-bar";
import {
  BrowserDownloadsPanel,
  type BrowserDownloadViewModel,
} from "./browser-downloads-panel";
import {
  BrowserHistoryPanel,
  type BrowserHistoryEntryViewModel,
} from "./browser-history-panel";
import {
  BrowserAddressSuggestions,
  browserAddressRows,
  browserAddressSuggestions,
} from "./browser-address-suggestions";
import {
  BrowserClearDataPanel,
  type BrowserClearDataOptionsViewModel,
} from "./browser-clear-data-panel";
import { browserPanelBounds } from "../lib/browser-panel-bounds";
import { useKeyboardShortcutBinding } from "@/providers/keyboard-shortcuts-provider";
import {
  keyboardShortcutLabel,
  matchesKeyboardShortcut,
} from "../../../../shared/keyboard-shortcuts";

const BLANK_URL = "about:blank";
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;

interface BrowserState {
  activeTabId: string;
  tabs: BrowserTabViewModel[];
}

interface FindState {
  activeMatchOrdinal: number;
  matches: number;
}

type AnimationState = "closed" | "opening" | "open" | "closing";
/** A DOM overlay that needs the native page view out of its way. */
type BrowserOverlayId = "device" | "scale" | "address";

const EMPTY_BROWSER_STATE: BrowserState = { activeTabId: "", tabs: [] };
const EMPTY_FIND_STATE: FindState = { activeMatchOrdinal: 0, matches: 0 };

function getBrowserApi(): Window["api"]["browser"] | null {
  return (window as any).api?.browser ?? null;
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

function browserCaptureUrl(captureName: string): string {
  return `mains-capture://cap/${encodeURIComponent(captureName)}`;
}

function downloadToastName(fileName: string): string {
  if (fileName.length <= 52) return fileName;
  const extensionAt = fileName.lastIndexOf(".");
  const extension = extensionAt > 0 ? fileName.slice(extensionAt) : "";
  const visibleExtension = extension.length <= 12 ? extension : "";
  return `${fileName.slice(0, 51 - visibleExtension.length)}…${visibleExtension}`;
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to load browser preview"));
    image.src = src;
  });
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function BrowserPanel() {
  const { isOpen, close } = useBrowserPanel();
  const dispatch = useAppDispatch();
  const viewportRef = useRef<HTMLDivElement>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const browserMenuButtonRef = useRef<HTMLButtonElement>(null);
  const activeTabIdRef = useRef("");
  const browserMenuOperationRef = useRef(0);
  const browserMenuOpeningRef = useRef(false);
  const browserMenuPreviewNameRef = useRef<string | null>(null);
  const browserMenuPreviewRevisionRef = useRef(0);
  // DOM overlays that sit over the page — the device toolbar's dropdowns and
  // the address suggestions. The page is a native view drawn above the DOM,
  // so while any is open it is swapped for a screenshot of itself.
  const overlayOperationRef = useRef(0);
  const overlaysOpenRef = useRef(new Set<BrowserOverlayId>());
  const overlayRestoreTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const downloadStatesRef = useRef<
    Map<string, BrowserDownloadViewModel["state"]>
  >(new Map());
  const [browserState, setBrowserState] = useState<BrowserState>(
    EMPTY_BROWSER_STATE,
  );
  const [urlInput, setUrlInput] = useState("");
  const [addressSuggestionsOpen, setAddressSuggestionsOpen] = useState(false);
  const [addressSuggestionIndex, setAddressSuggestionIndex] = useState(-1);
  const [selectMode, setSelectMode] = useState(false);
  const [attached, setAttached] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findState, setFindState] = useState<FindState>(EMPTY_FIND_STATE);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloads, setDownloads] = useState<BrowserDownloadViewModel[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<
    BrowserHistoryEntryViewModel[]
  >([]);
  const [browserMenuPreviewName, setBrowserMenuPreviewName] = useState<
    string | null
  >(null);
  const [browserMenuPosition, setBrowserMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const focusLocationShortcut = useKeyboardShortcutBinding(
    "browser.focusLocation",
  );
  const findShortcut = useKeyboardShortcutBinding("browser.find");
  const newTabShortcut = useKeyboardShortcutBinding("browser.newTab");
  const closeTabShortcut = useKeyboardShortcutBinding("browser.closeTab");
  const printShortcut = useKeyboardShortcutBinding("browser.print");
  const backShortcut = useKeyboardShortcutBinding("browser.back");
  const forwardShortcut = useKeyboardShortcutBinding("browser.forward");
  const zoomInShortcut = useKeyboardShortcutBinding("browser.zoomIn");
  const zoomOutShortcut = useKeyboardShortcutBinding("browser.zoomOut");
  const resetZoomShortcut = useKeyboardShortcutBinding("browser.resetZoom");
  const nextTabShortcut = useKeyboardShortcutBinding("browser.nextTab");
  const previousTabShortcut = useKeyboardShortcutBinding(
    "browser.previousTab",
  );

  const [animState, dispatchAnim] = useReducer(
    (_: AnimationState, next: AnimationState) => next,
    isOpen ? "open" : "closed",
  );

  const api = getBrowserApi();
  const browserPanelWidth = useAppSelector(
    (state) => state.appSettings.browserPanelWidth,
  );
  const activeTab =
    browserState.tabs.find((tab) => tab.tabId === browserState.activeTabId) ??
    null;
  const isBlank = !activeTab?.url || activeTab.url === BLANK_URL;
  // The typed input leads the rows, so the default selection (0) is exactly
  // what was typed; history matches follow it.
  const addressRows = useMemo(
    () =>
      browserAddressRows(
        urlInput,
        browserAddressSuggestions(historyEntries, urlInput),
      ),
    [historyEntries, urlInput],
  );
  const selectedAddressSuggestionIndex =
    addressRows.length > 0
      ? Math.min(Math.max(addressSuggestionIndex, 0), addressRows.length - 1)
      : -1;

  const applyBrowserState = useCallback((state: BrowserState) => {
    if (
      activeTabIdRef.current &&
      activeTabIdRef.current !== state.activeTabId
    ) {
      setFindState(EMPTY_FIND_STATE);
    }
    activeTabIdRef.current = state.activeTabId;
    setBrowserState(state);
    const active = state.tabs.find((tab) => tab.tabId === state.activeTabId);
    if (
      active &&
      document.activeElement !== locationInputRef.current
    ) {
      setUrlInput(active.url === BLANK_URL ? "" : active.url);
    }
  }, []);

  const applyResponseState = useCallback(
    (response: any, fallbackError: string) => {
      if (response?.success && response.data) {
        applyBrowserState(response.data as BrowserState);
        return true;
      }
      if (response?.success === false) {
        toast.error(response.error || fallbackError);
      }
      return false;
    },
    [applyBrowserState],
  );

  const applyDownloads = useCallback(
    (nextDownloads: BrowserDownloadViewModel[], notify: boolean) => {
      const previousStates = downloadStatesRef.current;

      if (notify) {
        for (const download of nextDownloads) {
          const previousState = previousStates.get(download.id);
          if (previousState === download.state) continue;

          const toastId = `browser-download-${download.id}`;
          const name = downloadToastName(download.fileName);

          if (download.state === "progressing") {
            toast(`Downloading ${name}…`, {
              id: toastId,
              duration: 2500,
              icon: <Download className="size-4" />,
            });
          } else if (download.state === "paused") {
            toast(`Download paused: ${name}`, {
              id: toastId,
              duration: 2500,
            });
          } else if (download.state === "completed") {
            toast.success(`${name} downloaded`, {
              id: toastId,
              duration: 4000,
              action: api
                ? {
                    label: "Open",
                    onClick: () => {
                      void api.openDownload(download.id).then((response: any) => {
                        if (response?.success === false) {
                          toast.error(
                            response.error || "Failed to open download",
                          );
                        }
                      });
                    },
                  }
                : undefined,
            });
          } else if (download.state === "cancelled") {
            toast(`Download cancelled: ${name}`, { id: toastId });
          } else if (download.state === "interrupted") {
            toast.error(`Download failed: ${name}`, {
              id: toastId,
              duration: 5000,
            });
          }
        }
      }

      downloadStatesRef.current = new Map(
        nextDownloads.map((download) => [download.id, download.state]),
      );
      setDownloads(nextDownloads);
    },
    [api],
  );

  useEffect(() => {
    dispatchAnim(isOpen ? "opening" : "closing");
  }, [isOpen]);

  useEffect(() => {
    if (animState === "opening") {
      const timer = setTimeout(() => dispatchAnim("open"), 50);
      return () => clearTimeout(timer);
    }
    if (animState === "closing") {
      const timer = setTimeout(() => dispatchAnim("closed"), 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [animState]);

  const isVisible = animState !== "closed";
  const isAnimatedIn = animState === "open";

  const syncBounds = useCallback(() => {
    const node = viewportRef.current;
    if (!node || !api) return;
    void api.setBounds(browserPanelBounds(node.getBoundingClientRect()));
  }, [api]);

  useEffect(() => {
    if (!api) return;
    if (!isOpen) {
      void api.detach();
      queueMicrotask(() => setAttached(false));
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const node = viewportRef.current;
      if (!node) return;
      void api
        .attach(browserPanelBounds(node.getBoundingClientRect()))
        .then((response: any) => {
          if (cancelled) return;
          applyResponseState(response, "Failed to open browser");
          setAttached(true);
        });
    }, 360);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      void api.detach();
      queueMicrotask(() => setAttached(false));
    };
  }, [api, applyResponseState, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !attached) return;
    syncBounds();
    const postAnimation = setTimeout(syncBounds, 360);
    const node = viewportRef.current;
    if (!node) return () => clearTimeout(postAnimation);
    const observer = new ResizeObserver(syncBounds);
    observer.observe(node);
    window.addEventListener("resize", syncBounds);
    return () => {
      clearTimeout(postAnimation);
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [attached, isOpen, syncBounds]);

  useEffect(() => {
    if (!api) return;
    const offState = api.onStateChanged((state) => applyBrowserState(state));
    const offMode = api.onSelectModeChanged(({ enabled }) =>
      setSelectMode(enabled),
    );
    const offSelection = api.onSelection((selection) => {
      dispatch(
        addContextItem({
          kind: "browser",
          ...(selection as ContextBrowserSelection),
        }),
      );
      toast.success("Added browser selection to chat context");
    });
    const offFind = api.onFindResult((result) => {
      if (result.tabId !== activeTabIdRef.current) return;
      setFindState({
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });
    const offShortcut = api.onShortcut(({ action }) => {
      if (action === "focus-location") {
        locationInputRef.current?.focus();
        locationInputRef.current?.select();
      } else if (action === "find") {
        setFindOpen(true);
      }
    });
    const offDownloads = api.onDownloadsChanged((nextDownloads) => {
      applyDownloads(nextDownloads as BrowserDownloadViewModel[], true);
    });
    const offHistory = api.onHistoryChanged((entries) => {
      setHistoryEntries(entries as BrowserHistoryEntryViewModel[]);
    });

    void api.getState().then((response: any) => {
      applyResponseState(response, "Failed to load browser tabs");
    });
    void api.getDownloads().then((response: any) => {
      if (response?.success && Array.isArray(response.data)) {
        applyDownloads(response.data as BrowserDownloadViewModel[], false);
      } else if (response?.success === false) {
        toast.error(response.error || "Failed to load downloads");
      }
    });
    void api.getHistory().then((response: any) => {
      if (response?.success && Array.isArray(response.data)) {
        setHistoryEntries(response.data as BrowserHistoryEntryViewModel[]);
      } else if (response?.success === false) {
        toast.error(response.error || "Failed to load history");
      }
    });

    return () => {
      offState();
      offMode();
      offSelection();
      offFind();
      offShortcut();
      offDownloads();
      offHistory();
    };
  }, [api, applyBrowserState, applyDownloads, applyResponseState, dispatch]);

  useEffect(() => {
    if (!api || !findOpen) return;
    if (!findQuery) {
      void api.stopFindInPage("clearSelection");
      return;
    }
    void api.findInPage({
      query: findQuery,
      forward: true,
      findNext: true,
    });
  }, [api, browserState.activeTabId, findOpen, findQuery]);

  const createTab = useCallback(() => {
    if (!api) return;
    void api.createTab().then((response: any) => {
      if (applyResponseState(response, "Failed to create tab")) {
        requestAnimationFrame(() => locationInputRef.current?.focus());
      }
    });
  }, [api, applyResponseState]);

  const closeTab = useCallback(
    (tabId: string) => {
      if (!api) return;
      void api.closeTab(tabId).then((response: any) => {
        applyResponseState(response, "Failed to close tab");
      });
    },
    [api, applyResponseState],
  );

  const activateTab = useCallback(
    (tabId: string) => {
      if (!api || tabId === browserState.activeTabId) return;
      setFindState(EMPTY_FIND_STATE);
      void api.activateTab(tabId).then((response: any) => {
        applyResponseState(response, "Failed to open tab");
      });
    },
    [api, applyResponseState, browserState.activeTabId],
  );

  const clearBrowserMenuPreview = useCallback(async () => {
    browserMenuPreviewRevisionRef.current += 1;
    const captureName = browserMenuPreviewNameRef.current;
    browserMenuPreviewNameRef.current = null;
    setBrowserMenuPreviewName(null);
    if (captureName && api) {
      await api.deleteCapture(captureName);
    }
  }, [api]);

  const refreshBrowserMenuPreview = useCallback(async () => {
    if (!api || !browserMenuOpen) return;

    const operation = browserMenuOperationRef.current;
    const revision = browserMenuPreviewRevisionRef.current + 1;
    browserMenuPreviewRevisionRef.current = revision;
    let pendingCaptureName: string | null = null;

    try {
      const response = await api.captureScreenshot("viewport");
      const captureName = response?.success
        ? (response.data as ContextBrowserSelection | undefined)
            ?.screenshotCaptureName
        : undefined;
      if (!captureName) {
        toast.error(response?.error || "Failed to refresh browser preview");
        return;
      }
      pendingCaptureName = captureName;

      await preloadImage(browserCaptureUrl(captureName));
      if (
        revision !== browserMenuPreviewRevisionRef.current ||
        operation !== browserMenuOperationRef.current
      ) {
        return;
      }

      const previousCaptureName = browserMenuPreviewNameRef.current;
      browserMenuPreviewNameRef.current = captureName;
      setBrowserMenuPreviewName(captureName);
      pendingCaptureName = null;
      await waitForPaint();

      if (previousCaptureName && previousCaptureName !== captureName) {
        await api.deleteCapture(previousCaptureName);
      }
    } catch {
      toast.error("Failed to refresh browser preview");
    } finally {
      if (pendingCaptureName) {
        await api.deleteCapture(pendingCaptureName);
      }
    }
  }, [api, browserMenuOpen]);

  const setZoom = useCallback(
    async (factor: number) => {
      if (!api) return;
      const response = await api.setZoomFactor(clampZoom(factor));
      if (response?.success === false) {
        toast.error(response.error || "Failed to change browser zoom");
        return;
      }
      await refreshBrowserMenuPreview();
    },
    [api, refreshBrowserMenuPreview],
  );

  const updateDeviceEmulation = useCallback(
    async (device: BrowserDeviceEmulationViewModel) => {
      if (!api) return;
      const response = await api.setDeviceEmulation(device);
      applyResponseState(response, "Failed to update device emulation");
    },
    [api, applyResponseState],
  );

  const restoreBrowserView = useCallback(async () => {
    if (api && isOpen) {
      await api.setVisible(true);
      syncBounds();
    }
    await clearBrowserMenuPreview();
  }, [api, clearBrowserMenuPreview, isOpen, syncBounds]);

  const suspendBrowserViewForOverlay = useCallback(async () => {
    if (!api || !isOpen || overlaysOpenRef.current.size === 0) return;

    const operation = overlayOperationRef.current + 1;
    overlayOperationRef.current = operation;
    let pendingCaptureName: string | null = null;

    try {
      const response = await api.captureScreenshot("viewport");
      const captureName = response?.success
        ? (response.data as ContextBrowserSelection | undefined)
            ?.screenshotCaptureName
        : undefined;
      if (!captureName) return;
      pendingCaptureName = captureName;

      await preloadImage(browserCaptureUrl(captureName));
      if (
        operation !== overlayOperationRef.current ||
        overlaysOpenRef.current.size === 0 ||
        !isOpen
      ) {
        return;
      }

      const previousCaptureName = browserMenuPreviewNameRef.current;
      browserMenuPreviewNameRef.current = captureName;
      setBrowserMenuPreviewName(captureName);
      pendingCaptureName = null;
      await waitForPaint();

      if (
        operation !== overlayOperationRef.current ||
        overlaysOpenRef.current.size === 0 ||
        !isOpen
      ) {
        return;
      }

      const visibilityResponse = await api.setVisible(false);
      if (visibilityResponse?.success === false) {
        await clearBrowserMenuPreview();
        return;
      }

      if (previousCaptureName && previousCaptureName !== captureName) {
        await api.deleteCapture(previousCaptureName);
      }
    } finally {
      if (pendingCaptureName) {
        await api.deleteCapture(pendingCaptureName);
      }
    }
  }, [api, clearBrowserMenuPreview, isOpen]);

  const handleOverlayOpenChange = useCallback(
    (id: BrowserOverlayId, open: boolean) => {
      if (overlayRestoreTimerRef.current !== null) {
        clearTimeout(overlayRestoreTimerRef.current);
        overlayRestoreTimerRef.current = null;
      }

      if (open) {
        const wasClosed = overlaysOpenRef.current.size === 0;
        overlaysOpenRef.current.add(id);
        if (wasClosed) void suspendBrowserViewForOverlay();
        return;
      }

      overlaysOpenRef.current.delete(id);
      if (overlaysOpenRef.current.size > 0) return;

      overlayRestoreTimerRef.current = setTimeout(() => {
        overlayRestoreTimerRef.current = null;
        if (overlaysOpenRef.current.size > 0) return;
        overlayOperationRef.current += 1;
        void restoreBrowserView();
      }, 50);
    },
    [restoreBrowserView, suspendBrowserViewForOverlay],
  );

  // The suggestions cover the top of the page instead of pushing it down.
  const addressOverlayOpen = addressSuggestionsOpen && addressRows.length > 0;
  useEffect(() => {
    if (!addressOverlayOpen) return;
    handleOverlayOpenChange("address", true);
    return () => handleOverlayOpenChange("address", false);
  }, [addressOverlayOpen, handleOverlayOpenChange]);

  const closeDeviceToolbar = useCallback(async () => {
    const device = activeTab?.deviceEmulation;
    if (!device) return;
    overlaysOpenRef.current.clear();
    overlayOperationRef.current += 1;
    if (overlayRestoreTimerRef.current !== null) {
      clearTimeout(overlayRestoreTimerRef.current);
      overlayRestoreTimerRef.current = null;
    }
    await restoreBrowserView();
    await updateDeviceEmulation({ ...device, enabled: false });
  }, [activeTab?.deviceEmulation, restoreBrowserView, updateDeviceEmulation]);

  const closeBrowserMenu = useCallback(() => {
    browserMenuOperationRef.current += 1;
    browserMenuPreviewRevisionRef.current += 1;
    browserMenuOpeningRef.current = false;
    setBrowserMenuOpen(false);
    setDownloadsOpen(false);
    setHistoryOpen(false);
    setClearDataOpen(false);
    void restoreBrowserView();
  }, [restoreBrowserView]);

  const toggleBrowserMenu = useCallback(async () => {
    if (browserMenuOpeningRef.current) {
      browserMenuOperationRef.current += 1;
      browserMenuOpeningRef.current = false;
      return;
    }
    if (browserMenuOpen) {
      closeBrowserMenu();
      return;
    }
    const rect = browserMenuButtonRef.current?.getBoundingClientRect();
    if (!rect || !api) return;
    setBrowserMenuPosition({
      x: rect.right - 260,
      y: rect.bottom + 6,
    });

    const operation = browserMenuOperationRef.current + 1;
    browserMenuOperationRef.current = operation;
    browserMenuOpeningRef.current = true;
    setDownloadsOpen(false);
    setHistoryOpen(false);
    setClearDataOpen(false);
    let pendingCaptureName: string | null = null;

    try {
      if (!isBlank) {
        const response = await api.captureScreenshot("viewport");
        const captureName = response?.success
          ? (response.data as ContextBrowserSelection | undefined)
              ?.screenshotCaptureName
          : undefined;
        if (!captureName) {
          toast.error(response?.error || "Failed to open browser menu");
          return;
        }
        pendingCaptureName = captureName;

        await preloadImage(browserCaptureUrl(captureName));
        if (operation !== browserMenuOperationRef.current || !isOpen) return;

        browserMenuPreviewNameRef.current = captureName;
        setBrowserMenuPreviewName(captureName);
        pendingCaptureName = null;
        await waitForPaint();
        if (operation !== browserMenuOperationRef.current || !isOpen) {
          await clearBrowserMenuPreview();
          return;
        }
      }

      const visibilityResponse = await api.setVisible(false);
      if (visibilityResponse?.success === false) {
        toast.error(visibilityResponse.error || "Failed to open browser menu");
        await clearBrowserMenuPreview();
        return;
      }
      if (operation !== browserMenuOperationRef.current || !isOpen) {
        await restoreBrowserView();
        return;
      }
      setBrowserMenuOpen(true);
    } catch {
      toast.error("Failed to open browser menu");
      await restoreBrowserView();
    } finally {
      if (pendingCaptureName) {
        await api.deleteCapture(pendingCaptureName);
      }
      if (operation === browserMenuOperationRef.current) {
        browserMenuOpeningRef.current = false;
      }
    }
  }, [
    api,
    browserMenuOpen,
    clearBrowserMenuPreview,
    closeBrowserMenu,
    isBlank,
    isOpen,
    restoreBrowserView,
  ]);

  const prepareBrowserMenuAction = useCallback(async () => {
    browserMenuOperationRef.current += 1;
    browserMenuPreviewRevisionRef.current += 1;
    browserMenuOpeningRef.current = false;
    setBrowserMenuOpen(false);
    setDownloadsOpen(false);
    setHistoryOpen(false);
    setClearDataOpen(false);
    if (!api) return false;
    await restoreBrowserView();
    return true;
  }, [api, restoreBrowserView]);

  const toggleDeviceToolbarFromMenu = useCallback(async () => {
    const device = activeTab?.deviceEmulation;
    if (!device || !(await prepareBrowserMenuAction())) return;
    await updateDeviceEmulation({ ...device, enabled: !device.enabled });
  }, [
    activeTab?.deviceEmulation,
    prepareBrowserMenuAction,
    updateDeviceEmulation,
  ]);

  const openDownloadsFromMenu = useCallback(() => {
    const rect = browserMenuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setBrowserMenuPosition({
        x: rect.right - 360,
        y: rect.bottom + 6,
      });
    }
    setDownloadsOpen(true);
    setHistoryOpen(false);
    setClearDataOpen(false);
  }, []);

  const openHistoryFromMenu = useCallback(() => {
    const rect = browserMenuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setBrowserMenuPosition({
        x: rect.right - 360,
        y: rect.bottom + 6,
      });
    }
    setDownloadsOpen(false);
    setHistoryOpen(true);
    setClearDataOpen(false);
  }, []);

  const openClearDataFromMenu = useCallback(() => {
    const rect = browserMenuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setBrowserMenuPosition({
        x: rect.right - 360,
        y: rect.bottom + 6,
      });
    }
    setDownloadsOpen(false);
    setHistoryOpen(false);
    setClearDataOpen(true);
  }, []);

  const returnToBrowserMenu = useCallback(() => {
    const rect = browserMenuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setBrowserMenuPosition({
        x: rect.right - 260,
        y: rect.bottom + 6,
      });
    }
    setDownloadsOpen(false);
    setHistoryOpen(false);
    setClearDataOpen(false);
  }, []);

  const clearBrowsingData = useCallback(
    async (options: BrowserClearDataOptionsViewModel): Promise<boolean> => {
      if (!api) return false;
      const response = await api.clearBrowsingData(options);
      if (response?.success && response.data) {
        const result = response.data as {
          history: BrowserHistoryEntryViewModel[];
          downloads: BrowserDownloadViewModel[];
        };
        setHistoryEntries(result.history);
        setDownloads(result.downloads);
        toast.success("Browsing data cleared");
        await prepareBrowserMenuAction();
        return true;
      }
      toast.error(response?.error || "Failed to clear browsing data");
      return false;
    },
    [api, prepareBrowserMenuAction],
  );

  const cancelDownload = useCallback(
    async (downloadId: string) => {
      if (!api) return;
      const response = await api.cancelDownload(downloadId);
      if (response?.success && Array.isArray(response.data)) {
        setDownloads(response.data as BrowserDownloadViewModel[]);
      } else if (response?.success === false) {
        toast.error(response.error || "Failed to cancel download");
      }
    },
    [api],
  );

  const clearDownloads = useCallback(async () => {
    if (!api) return;
    const response = await api.clearDownloads();
    if (response?.success && Array.isArray(response.data)) {
      setDownloads(response.data as BrowserDownloadViewModel[]);
    } else if (response?.success === false) {
      toast.error(response.error || "Failed to clear downloads");
    }
  }, [api]);

  const openDownload = useCallback(
    async (downloadId: string) => {
      if (!api) return;
      const response = await api.openDownload(downloadId);
      if (response?.success === false) {
        toast.error(response.error || "Failed to open download");
      }
    },
    [api],
  );

  const showDownloadInFolder = useCallback(
    async (downloadId: string) => {
      if (!api) return;
      const response = await api.showDownloadInFolder(downloadId);
      if (response?.success === false) {
        toast.error(response.error || "Failed to show download in Finder");
      }
    },
    [api],
  );

  const clearHistory = useCallback(async () => {
    if (!api) return;
    const response = await api.clearHistory();
    if (response?.success && Array.isArray(response.data)) {
      setHistoryEntries(response.data as BrowserHistoryEntryViewModel[]);
    } else if (response?.success === false) {
      toast.error(response.error || "Failed to clear history");
    }
  }, [api]);

  const removeHistoryEntry = useCallback(
    async (historyEntryId: string) => {
      if (!api) return;
      const response = await api.removeHistoryEntry(historyEntryId);
      if (response?.success && Array.isArray(response.data)) {
        setHistoryEntries(response.data as BrowserHistoryEntryViewModel[]);
      } else if (response?.success === false) {
        toast.error(response.error || "Failed to remove history entry");
      }
    },
    [api],
  );

  const openHistoryEntry = useCallback(
    async (url: string) => {
      if (!(await prepareBrowserMenuAction()) || !api) return;
      const response = await api.navigate(url);
      if (response?.success === false) {
        toast.error(response.error || "Failed to open history entry");
      }
    },
    [api, prepareBrowserMenuAction],
  );

  const openHistoryEntryInNewTab = useCallback(
    async (url: string) => {
      if (!(await prepareBrowserMenuAction()) || !api) return;
      const response = await api.createTab(url);
      applyResponseState(response, "Failed to open history entry");
    },
    [api, applyResponseState, prepareBrowserMenuAction],
  );

  const openFindFromMenu = useCallback(async () => {
    if (!(await prepareBrowserMenuAction())) return;
    setFindOpen(true);
  }, [prepareBrowserMenuAction]);

  const printPage = useCallback(async () => {
    if (!(await prepareBrowserMenuAction()) || !api) return;
    const response = await api.printPage();
    if (response?.success === false) {
      toast.error(response.error || "Failed to print page");
      return;
    }
    const result = response?.data as
      | { printed: boolean; failureReason?: string }
      | undefined;
    if (result?.printed) {
      toast.success("Print job sent");
    } else if (result?.failureReason && !/cancel/i.test(result.failureReason)) {
      toast.error(result.failureReason);
    }
  }, [api, prepareBrowserMenuAction]);

  const takeScreenshot = useCallback(
    async (mode: "viewport" | "fullPage") => {
      if (!(await prepareBrowserMenuAction()) || !api) return;
      const response = await api.captureScreenshot(mode);
      if (response?.success && response.data) {
        dispatch(
          addContextItem({
            kind: "browser",
            ...(response.data as ContextBrowserSelection),
          }),
        );
        toast.success(
          mode === "fullPage"
            ? "Full-page screenshot added to chat context"
            : "Screenshot added to chat context",
        );
      } else {
        toast.error(response?.error || "Failed to capture page");
      }
    },
    [api, dispatch, prepareBrowserMenuAction],
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (matchesKeyboardShortcut(event, focusLocationShortcut)) {
        event.preventDefault();
        locationInputRef.current?.focus();
        locationInputRef.current?.select();
      } else if (matchesKeyboardShortcut(event, findShortcut)) {
        event.preventDefault();
        setFindOpen(true);
      } else if (matchesKeyboardShortcut(event, printShortcut)) {
        event.preventDefault();
        void printPage();
      } else if (matchesKeyboardShortcut(event, newTabShortcut)) {
        event.preventDefault();
        createTab();
      } else if (matchesKeyboardShortcut(event, closeTabShortcut) && activeTab) {
        event.preventDefault();
        closeTab(activeTab.tabId);
      } else if (matchesKeyboardShortcut(event, backShortcut) && activeTab) {
        event.preventDefault();
        void api?.back();
      } else if (matchesKeyboardShortcut(event, forwardShortcut) && activeTab) {
        event.preventDefault();
        void api?.forward();
      } else if (matchesKeyboardShortcut(event, zoomInShortcut) && activeTab) {
        event.preventDefault();
        void setZoom(activeTab.zoomFactor + ZOOM_STEP);
      } else if (matchesKeyboardShortcut(event, zoomOutShortcut) && activeTab) {
        event.preventDefault();
        void setZoom(activeTab.zoomFactor - ZOOM_STEP);
      } else if (matchesKeyboardShortcut(event, resetZoomShortcut)) {
        event.preventDefault();
        void setZoom(1);
      } else if (
        (matchesKeyboardShortcut(event, nextTabShortcut) ||
          matchesKeyboardShortcut(event, previousTabShortcut)) &&
        browserState.tabs.length > 1
      ) {
        event.preventDefault();
        const current = browserState.tabs.findIndex(
          (tab) => tab.tabId === browserState.activeTabId,
        );
        const direction = matchesKeyboardShortcut(event, previousTabShortcut)
          ? -1
          : 1;
        const next =
          (current + direction + browserState.tabs.length) %
          browserState.tabs.length;
        const tab = browserState.tabs[next];
        if (tab) activateTab(tab.tabId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTab,
    activateTab,
    browserState.activeTabId,
    browserState.tabs,
    closeTabShortcut,
    closeTab,
    createTab,
    findShortcut,
    focusLocationShortcut,
    isOpen,
    newTabShortcut,
    nextTabShortcut,
    previousTabShortcut,
    printShortcut,
    printPage,
    resetZoomShortcut,
    setZoom,
    backShortcut,
    forwardShortcut,
    zoomInShortcut,
    zoomOutShortcut,
    api,
  ]);

  const navigate = useCallback(
    (target = urlInput) => {
      const value = target.trim();
      if (!api || !value) return;
      setAddressSuggestionsOpen(false);
      setAddressSuggestionIndex(-1);
      locationInputRef.current?.blur();
      void api.navigate(value);
    },
    [api, urlInput],
  );

  const toggleSelect = useCallback(async () => {
    if (!api) return;
    const response = await api.setSelectMode(!selectMode);
    if (response?.success === false) {
      toast.error(response.error || "Failed to start browser selection");
    }
  }, [api, selectMode]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindState(EMPTY_FIND_STATE);
    void api?.stopFindInPage("clearSelection");
  }, [api]);

  const moveFind = useCallback(
    (forward: boolean) => {
      if (!api || !findQuery) return;
      void api.findInPage({ query: findQuery, forward, findNext: false });
    },
    [api, findQuery],
  );

  const updateFindQuery = useCallback((query: string) => {
    setFindState(EMPTY_FIND_STATE);
    setFindQuery(query);
  }, []);

  const closePanel = useCallback(async () => {
    browserMenuOperationRef.current += 1;
    browserMenuPreviewRevisionRef.current += 1;
    browserMenuOpeningRef.current = false;
    setBrowserMenuOpen(false);
    setDownloadsOpen(false);
    setHistoryOpen(false);
    setClearDataOpen(false);
    overlaysOpenRef.current.clear();
    overlayOperationRef.current += 1;
    if (overlayRestoreTimerRef.current !== null) {
      clearTimeout(overlayRestoreTimerRef.current);
      overlayRestoreTimerRef.current = null;
    }
    if (api) {
      if (selectMode) await api.setSelectMode(false);
      if (findOpen) await api.stopFindInPage("clearSelection");
      await api.detach();
    }
    await clearBrowserMenuPreview();
    close();
  }, [api, clearBrowserMenuPreview, close, findOpen, selectMode]);

  useEffect(() => {
    return () => {
      browserMenuOperationRef.current += 1;
      browserMenuPreviewRevisionRef.current += 1;
      overlayOperationRef.current += 1;
      if (overlayRestoreTimerRef.current !== null) {
        clearTimeout(overlayRestoreTimerRef.current);
      }
      const captureName = browserMenuPreviewNameRef.current;
      browserMenuPreviewNameRef.current = null;
      if (captureName) {
        void getBrowserApi()?.deleteCapture(captureName);
      }
    };
  }, []);

  if (!isVisible) return null;

  if (!api) {
    return (
      <div
        className="fixed inset-y-0 right-0 z-(--z-overlay) flex items-center justify-center border-l border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-950"
        style={{ width: "var(--browser-panel-width)" }}
      >
        <Text as="div" size="sm" tone="secondary">
          Browser panel is unavailable in this build.
        </Text>
      </div>
    );
  }

  const zoomFactor = activeTab?.zoomFactor ?? 1;
  const activeDownloadCount = downloads.filter(
    (download) =>
      download.state === "progressing" || download.state === "paused",
  ).length;

  return (
    <div
      className="fixed bottom-1.25 right-1.25 top-1.25 z-9999 flex flex-col overflow-hidden rounded-tr-xl border-l border-primary-200/70 bg-primary transition-[transform,opacity] duration-300 ease-out dark:border-primary-800/50 dark:bg-primary-950"
      style={{
        width: "var(--browser-panel-width)",
        transform: isAnimatedIn ? "translateX(0)" : "translateX(100%)",
        opacity: isAnimatedIn ? 1 : 0,
      }}
      role="complementary"
      aria-label="Embedded browser"
    >
      <ResizeHandle
        edge="left"
        value={browserPanelWidth}
        min={BROWSER_PANEL_WIDTH_MIN}
        max={BROWSER_PANEL_WIDTH_MAX}
        computeWidth={(clientX) => window.innerWidth - clientX}
        onPreview={(width) => setLayoutWidthVar(BROWSER_PANEL_WIDTH_VAR, width)}
        onCommit={(width) => dispatch(setBrowserPanelWidth(width))}
        onReset={() => dispatch(setBrowserPanelWidth(BROWSER_PANEL_WIDTH_DEFAULT))}
        onDragStart={() => void api.setVisible(false)}
        onDragEnd={() => {
          void api.setVisible(true);
          syncBounds();
        }}
        ariaLabel="Resize browser panel"
      />

      <BrowserTabStrip
        tabs={browserState.tabs}
        activeTabId={browserState.activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
        onCreate={createTab}
        onClosePanel={() => void closePanel()}
        newTabShortcutLabel={keyboardShortcutLabel(newTabShortcut)}
        closeTabShortcutLabel={keyboardShortcutLabel(closeTabShortcut)}
      />

      <div className="relative">
        <div className="flex items-center gap-1 border-b border-primary-200/60 px-2 py-1 dark:border-primary-800/50">
          <div className="flex items-center gap-1 rounded-full p-0.5 ">
            <Button
              tooltip="Back"
              tooltipShortcut={keyboardShortcutLabel(backShortcut)}
              tooltipPosition="top"
              onClick={() => void api.back()}
              disabled={!activeTab?.canGoBack}
              className="rounded-full p-0.5 text-primary-700 hover:bg-primary-200/60 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-800/60"
              aria-label="Back"
            >
              <ChevronLeft className="size-5" />
            </Button>
            <Button
              tooltip="Forward"
              tooltipShortcut={keyboardShortcutLabel(forwardShortcut)}
              tooltipPosition="top"
              onClick={() => void api.forward()}
              disabled={!activeTab?.canGoForward}
              className="rounded-full p-0.5 text-primary-700 hover:bg-primary-200/60 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-800/60"
              aria-label="Forward"
            >
              <ChevronLeft className="size-5 rotate-180" />
            </Button>
            <Button
              tooltip={activeTab?.isLoading ? "Stop" : "Reload"}
              tooltipPosition="top"
              onClick={() =>
                void (activeTab?.isLoading ? api.stop() : api.reload())
              }
              className="group rounded-full p-1 text-primary-700 hover:bg-primary-200/60 dark:text-primary-300 dark:hover:bg-primary-800/60"
              aria-label={activeTab?.isLoading ? "Stop" : "Reload"}
            >
              {activeTab?.isLoading ? (
                <Close className="size-4 transition-transform duration-200 group-active:rotate-90" />
              ) : (
                <Refresh className="size-4 rotate-180 transition-transform duration-200 group-active:rotate-90" />
              )}
            </Button>
          </div>

          <div className="min-w-0 flex-1">
            <Input
              ref={locationInputRef}
              type="text"
              role="combobox"
              value={urlInput}
              onChange={(event) => {
                setUrlInput(event.target.value);
                setAddressSuggestionsOpen(true);
                setAddressSuggestionIndex(0);
              }}
              onKeyDown={(event) => {
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  addressRows.length > 0
                ) {
                  event.preventDefault();
                  setAddressSuggestionsOpen(true);
                  setAddressSuggestionIndex((current) => {
                    if (current < 0) {
                      return event.key === "ArrowDown"
                        ? 0
                        : addressRows.length - 1;
                    }
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    const clampedCurrent = Math.min(
                      current,
                      addressRows.length - 1,
                    );
                    return (
                      (clampedCurrent + direction + addressRows.length) %
                      addressRows.length
                    );
                  });
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const row = addressSuggestionsOpen
                    ? addressRows[selectedAddressSuggestionIndex]
                    : undefined;
                  navigate(
                    row?.kind === "history" ? row.suggestion.url : urlInput,
                  );
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setAddressSuggestionsOpen(false);
                  setAddressSuggestionIndex(-1);
                }
              }}
              onFocus={(event) => {
                event.currentTarget.select();
                setAddressSuggestionsOpen(true);
                setAddressSuggestionIndex(addressRows.length > 0 ? 0 : -1);
              }}
              onClick={() => setAddressSuggestionsOpen(true)}
              onBlur={() => {
                setAddressSuggestionsOpen(false);
                setAddressSuggestionIndex(-1);
              }}
              placeholder="Search or enter address"
              aria-label="Search or enter address"
              aria-autocomplete="list"
              aria-controls={
                addressSuggestionsOpen && addressRows.length > 0
                  ? "browser-address-suggestions"
                  : undefined
              }
              aria-expanded={addressSuggestionsOpen && addressRows.length > 0}
              aria-activedescendant={
                addressSuggestionsOpen && selectedAddressSuggestionIndex >= 0
                  ? `browser-address-suggestion-${selectedAddressSuggestionIndex}`
                  : undefined
              }
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className="w-full rounded-full py-1.75 text-xs text-primary-900 placeholder:text-primary-500 focus:bg-primary-200/60 dark:text-primary-100 dark:focus:bg-primary-800/60"
              spellCheck={false}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1 rounded-full p-0.5 ">
            <Button
              tooltip={selectMode ? "Exit select mode" : "Select in browser"}
              tooltipShortcut="Esc"
              tooltipPosition="top-left"
              onClick={() => void toggleSelect()}
              className={`rounded-full p-1 transition-colors ${
                selectMode
                  ? "bg-primary-500/20 text-primary-800 dark:text-primary-200"
                  : "text-primary-700 hover:bg-primary-200/60 dark:text-primary-300 dark:hover:bg-primary-800/60"
              }`}
              aria-label={selectMode ? "Exit select mode" : "Select in browser"}
              aria-pressed={selectMode}
            >
              <Crop className="size-4" />
            </Button>
            <Button
              ref={browserMenuButtonRef}
              tooltip="Browser menu"
              tooltipPosition="top-left"
              onClick={() => void toggleBrowserMenu()}
              onMouseDown={(event) => event.stopPropagation()}
              className="rounded-full p-1 text-primary-700 hover:bg-primary-200/60 dark:text-primary-300 dark:hover:bg-primary-800/60"
              aria-label="Open browser menu"
              aria-haspopup="menu"
              aria-expanded={browserMenuOpen}
            >
              <Option className="size-4 rotate-90" />
            </Button>
          </div>
        </div>

        {addressSuggestionsOpen && (
          <div className="absolute inset-x-0 top-full z-(--z-dropdown)">
            <BrowserAddressSuggestions
              rows={addressRows}
              selectedIndex={selectedAddressSuggestionIndex}
              onHighlight={setAddressSuggestionIndex}
              onSelect={(row) => {
                if (row.kind === "input") {
                  navigate(row.value);
                  return;
                }
                setUrlInput(row.suggestion.url);
                navigate(row.suggestion.url);
              }}
              onRemove={(historyEntryId) => void removeHistoryEntry(historyEntryId)}
            />
          </div>
        )}
      </div>

      {activeTab?.deviceEmulation.enabled && (
        <BrowserDeviceToolbar
          device={activeTab.deviceEmulation}
          onChange={(device) => void updateDeviceEmulation(device)}
          onClose={() => void closeDeviceToolbar()}
          onDropdownOpenChange={handleOverlayOpenChange}
        />
      )}

      <DropdownMenu
        isOpen={browserMenuOpen}
        aria-label="Browser menu"
        position={browserMenuPosition}
        onClose={closeBrowserMenu}
        minWidth={downloadsOpen || historyOpen || clearDataOpen ? 360 : 260}
        origin="top-right"
        className="z-10000 "
      >
        {downloadsOpen ? (
          <BrowserDownloadsPanel
            downloads={downloads}
            onBack={returnToBrowserMenu}
            onCancel={(downloadId) => void cancelDownload(downloadId)}
            onClear={() => void clearDownloads()}
            onOpen={(downloadId) => void openDownload(downloadId)}
            onShowInFolder={(downloadId) =>
              void showDownloadInFolder(downloadId)
            }
          />
        ) : historyOpen ? (
          <BrowserHistoryPanel
            entries={historyEntries}
            onBack={returnToBrowserMenu}
            onClear={() => void clearHistory()}
            onOpen={(url) => void openHistoryEntry(url)}
            onOpenNewTab={(url) => void openHistoryEntryInNewTab(url)}
            onRemove={(historyEntryId) =>
              void removeHistoryEntry(historyEntryId)
            }
          />
        ) : clearDataOpen ? (
          <BrowserClearDataPanel
            onBack={returnToBrowserMenu}
            onClear={clearBrowsingData}
          />
        ) : (
          <>
            <DropdownMenuItem
              onClick={() => void openFindFromMenu()}
              disabled={isBlank}
              className="text-xs"
            >
              <Search className="size-3.5" />
              <span>Find in page</span>
              <Text as="span" size="xxs" tone="subtle" className="ml-auto">
                {keyboardShortcutLabel(findShortcut)}
              </Text>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void printPage()}
              disabled={isBlank}
              className="text-xs"
            >
              <Document className="size-3.5" />
              <span>Print…</span>
              <Text as="span" size="xxs" tone="subtle" className="ml-auto">
                {keyboardShortcutLabel(printShortcut)}
              </Text>
            </DropdownMenuItem>
            <div
              role="group"
              aria-label="Zoom controls"
              className="flex items-center gap-2 py-0.5"
            >
              <Text
                as="span"
                size="xs"
                tone="subtle"
                className="mr-auto pl-8.5"
              >
                Zoom
              </Text>
              <div className="flex h-6 items-center overflow-hidden rounded-lg glass-outline">
                <Button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => void setZoom(zoomFactor - ZOOM_STEP)}
                  disabled={isBlank || zoomFactor <= ZOOM_MIN}
                  aria-label="Zoom out"
                  className="h-full rounded-none px-2 text-primary-600 hover:bg-primary-200/60 hover:text-primary-900 dark:text-primary-300 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
                >
                  <Minus className="size-3" />
                </Button>
                <Text
                  as="span"
                  size="xs"
                  className="flex h-full min-w-12 items-center justify-center border-x border-primary-200/80 px-2 tabular-nums dark:border-primary-700/70"
                >
                  {Math.round(zoomFactor * 100)}%
                </Text>
                <Button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => void setZoom(zoomFactor + ZOOM_STEP)}
                  disabled={isBlank || zoomFactor >= ZOOM_MAX}
                  aria-label="Zoom in"
                  className="h-full rounded-none px-2 text-primary-600 hover:bg-primary-200/60 hover:text-primary-900 dark:text-primary-300 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              <Button
                role="menuitem"
                tabIndex={-1}
                onClick={() => void setZoom(1)}
                disabled={isBlank}
                aria-label="Reset zoom"
                className="rounded-lg p-1.5 mr-1 text-primary-600 hover:bg-primary-200/60 hover:text-primary-900 dark:text-primary-300 dark:hover:bg-primary-800/70 dark:hover:text-primary-100"
              >
                <Refresh className="size-3.5" />
              </Button>
            </div>
            <DropdownMenuItem
              className="text-xs"
              selected={activeTab?.deviceEmulation.enabled ?? false}
              indicator="none"
              onClick={() => void toggleDeviceToolbarFromMenu()}
              disabled={isBlank}
            >
              <DeviceMobile className="size-3.5" />
              <span>
                {activeTab?.deviceEmulation.enabled
                  ? "Hide device toolbar"
                  : "Show device toolbar"}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              onClick={() => void takeScreenshot("viewport")}
              disabled={isBlank}
            >
              <Picture className="size-3.5" />
              <span>Take a screenshot</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              onClick={() => void takeScreenshot("fullPage")}
              disabled={isBlank}
            >
              <View className="size-3.5" />
              <span>Capture full page</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={openDownloadsFromMenu}>
              <Download className="size-3.5" />
              <span>Downloads</span>
              {activeDownloadCount > 0 && (
                <Text
                  as="span"
                  size="xxs"
                  tone="subtle"
                  className="ml-auto rounded-full bg-primary-200/60 px-2 py-.5 tabular-nums dark:bg-primary-800/60"
                >
                  {activeDownloadCount}
                </Text>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={openHistoryFromMenu}>
              <Clock className="size-3.5" />
              <span>History</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              onClick={openClearDataFromMenu}
            >
              <Trash className="size-3.5" />
              <span>Clear browsing data</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenu>

      {findOpen && (
        <BrowserFindBar
          query={findQuery}
          activeMatchOrdinal={findState.activeMatchOrdinal}
          matches={findState.matches}
          onQueryChange={updateFindQuery}
          onPrevious={() => moveFind(false)}
          onNext={() => moveFind(true)}
          onClose={closeFind}
        />
      )}

      <BrowserDeviceStage
        device={activeTab?.deviceEmulation ?? null}
        viewportRef={viewportRef}
        onResize={(device) => void updateDeviceEmulation(device)}
        onFrameChange={syncBounds}
      >
        {isBlank && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-8 text-center pointer-events-none">
            <Text as="div" size="sm" tone="secondary">
              A fresh tab, ready when you are.
            </Text>
            <Text as="div" size="xxs" tone="subtle">
              Search the web or enter a local development URL.
            </Text>
          </div>
        )}
        {browserMenuPreviewName && (
          <img
            src={browserCaptureUrl(browserMenuPreviewName)}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-1 size-full select-none object-fill"
          />
        )}
        {activeTab?.isCrashed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-primary-50 dark:bg-primary-950">
            <Text as="div" size="sm" tone="secondary">
              This tab stopped responding.
            </Text>
            <Button variant="secondary" onClick={() => void api.reload()}>
              Reload tab
            </Button>
          </div>
        )}
        {selectMode && (
          <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-primary-500/90 px-2 py-0.5 text-t font-medium text-primary-100 shadow pointer-events-none">
            Click an element to capture · Esc to cancel
          </div>
        )}
      </BrowserDeviceStage>
    </div>
  );
}
