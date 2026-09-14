import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { addContextItem } from "@/lib/redux/slices/workspaceSlice";
import type { ContextBrowserSelection } from "@/features/workspace/lib/composer-context";
import { Button, Input, Text, toast } from "@/components/ui";
import {
  ChevronLeft,
  Close,
  Refresh,
  Crop,
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

/**
 * The native browser view is inset from the panel's left edge by this much so
 * the resize handle's column stays clear of it (the native view paints above
 * the DOM, so anything it covers can't be grabbed).
 */
const RESIZE_HANDLE_WIDTH = 8;

interface BrowserApi {
  attach: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<any>;
  detach: () => Promise<any>;
  setBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<any>;
  setVisible: (visible: boolean) => Promise<any>;
  navigate: (url: string) => Promise<any>;
  back: () => Promise<any>;
  forward: () => Promise<any>;
  reload: () => Promise<any>;
  stop: () => Promise<any>;
  setSelectMode: (enabled: boolean) => Promise<any>;
  getNavState: () => Promise<any>;
  onNavState: (cb: (state: NavState) => void) => () => void;
  onSelectModeChanged: (cb: (data: { enabled: boolean }) => void) => () => void;
  onSelection: (cb: (selection: ContextBrowserSelection) => void) => () => void;
}

interface NavState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

const INITIAL_NAV: NavState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
};

type AnimationState = "closed" | "opening" | "open" | "closing";

function getBrowserApi(): BrowserApi | null {
  const api = (window as any).api?.browser;
  return api ?? null;
}

export function BrowserPanel() {
  const { isOpen, close } = useBrowserPanel();
  const dispatch = useAppDispatch();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const [urlInput, setUrlInput] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [attached, setAttached] = useState(false);

  const [animState, dispatchAnim] = useReducer(
    (_: AnimationState, next: AnimationState) => next,
    isOpen ? "open" : "closed",
  );

  const api = getBrowserApi();
  const browserPanelWidth = useAppSelector((s) => s.appSettings.browserPanelWidth);

  // Drive animation state from isOpen
  useEffect(() => {
    dispatchAnim(isOpen ? "opening" : "closing");
  }, [isOpen]);

  useEffect(() => {
    if (animState === "opening") {
      const t = setTimeout(() => dispatchAnim("open"), 50);
      return () => clearTimeout(t);
    }
    if (animState === "closing") {
      const t = setTimeout(() => dispatchAnim("closed"), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [animState]);

  const isVisible = animState !== "closed";
  const isAnimatedIn = animState === "open";

  const syncBounds = useCallback(() => {
    const node = viewportRef.current;
    if (!node || !api) return;
    const rect = node.getBoundingClientRect();
    api.setBounds({
      x: Math.max(0, Math.round(rect.left)) + RESIZE_HANDLE_WIDTH,
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(1, Math.round(rect.width) - RESIZE_HANDLE_WIDTH),
      height: Math.max(1, Math.round(rect.height)),
    });
  }, [api]);

  // Attach / detach native view.
  // Delay attach until after the slide-in animation (50ms dispatch + 300ms CSS) so the
  // initial bounds calculation sees the panel in its final position.
  useEffect(() => {
    if (!api) return;
    if (!isOpen) {
      if (attached) {
        api.detach();
        queueMicrotask(() => setAttached(false));
      }
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const node = viewportRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      api
        .attach({
          x: Math.max(0, Math.round(rect.left)) + RESIZE_HANDLE_WIDTH,
          y: Math.max(0, Math.round(rect.top)),
          width: Math.max(1, Math.round(rect.width) - RESIZE_HANDLE_WIDTH),
          height: Math.max(1, Math.round(rect.height)),
        })
        .then(() => {
          if (!cancelled) setAttached(true);
        });
    }, 360);
    return () => {
      cancelled = true;
      clearTimeout(t);
      api.detach();
      queueMicrotask(() => setAttached(false));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, api]);

  // Keep bounds in sync.
  // The panel slides in via translateX (50ms dispatch + 300ms CSS transition = ~350ms).
  // We must re-sync after the animation finishes, not just at attach time.
  useLayoutEffect(() => {
    if (!isOpen || !attached) return;
    syncBounds();
    // Re-sync once animation is done so the native view lands at the correct position.
    const postAnim = setTimeout(syncBounds, 360);
    const node = viewportRef.current;
    if (!node) return () => clearTimeout(postAnim);
    const ro = new ResizeObserver(() => syncBounds());
    ro.observe(node);
    window.addEventListener("resize", syncBounds);
    return () => {
      clearTimeout(postAnim);
      ro.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [isOpen, attached, syncBounds]);

  // Subscribe to main-process events
  useEffect(() => {
    if (!api) return;
    const offNav = api.onNavState((state) => {
      setNav(state);
      setUrlInput((prev) =>
        document.activeElement?.tagName === "INPUT" ? prev : state.url,
      );
    });
    const offMode = api.onSelectModeChanged(({ enabled }) =>
      setSelectMode(enabled),
    );
    const offSel = api.onSelection((sel) => {
      dispatch(addContextItem({ kind: "browser", ...sel }));
      toast.success("Added browser selection to chat context");
    });
    api.getNavState().then((res: any) => {
      if (res?.success && res.data) {
        setNav(res.data);
        setUrlInput(res.data.url || "");
      }
    });
    return () => {
      offNav();
      offMode();
      offSel();
    };
  }, [api, dispatch]);

  const handleNavigate = useCallback(() => {
    if (!api) return;
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    api.navigate(trimmed);
  }, [api, urlInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleNavigate();
      }
    },
    [handleNavigate],
  );

  const handleToggleSelect = useCallback(async () => {
    if (!api) return;
    await api.setSelectMode(!selectMode);
  }, [api, selectMode]);

  const handleBack = useCallback(() => api?.back(), [api]);
  const handleForward = useCallback(() => api?.forward(), [api]);
  const handleReload = useCallback(() => {
    if (!api) return;
    if (nav.isLoading) api.stop();
    else api.reload();
  }, [api, nav.isLoading]);

  const handleClose = useCallback(async () => {
    if (api) {
      if (selectMode) await api.setSelectMode(false);
      await api.detach();
    }
    close();
  }, [api, close, selectMode]);

  if (!isVisible) return null;

  if (!api) {
    return (
      <div
        className="fixed top-0 bottom-0 right-0 z-(--z-overlay) flex items-center justify-center  bg-primary-50 dark:bg-primary-950 border-l border-primary-200 dark:border-primary-800"
        style={{ width: "var(--browser-panel-width)" }}
      >
        <Text as="div" size="sm" tone="secondary">
          Browser panel is unavailable in this build.
        </Text>
      </div>
    );
  }

  return (
    <div
      className="fixed top-1.25 bottom-1.25 right-1.25 dark:bg-primary-950 bg-primary rounded-tr-xl  z-9999 flex flex-col border-l border-primary-200/70 dark:border-primary-800/50 transition-[transform,opacity] duration-300 ease-out overflow-hidden"
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
        onPreview={(w) => setLayoutWidthVar(BROWSER_PANEL_WIDTH_VAR, w)}
        onCommit={(w) => dispatch(setBrowserPanelWidth(w))}
        onReset={() => dispatch(setBrowserPanelWidth(BROWSER_PANEL_WIDTH_DEFAULT))}
        onDragStart={() => void api.setVisible(false)}
        onDragEnd={() => {
          void api.setVisible(true);
          syncBounds();
        }}
        ariaLabel="Resize browser panel"
      />
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-primary-200/60 dark:border-primary-800/50 ">
      <div className="flex items-center gap-1 rounded-full glass-outline p-0.5">
        <Button
          tooltip="Back"
          tooltipPosition="bottom"
          onClick={handleBack}
          disabled={!nav.canGoBack}
          className="p-0.5 rounded-full cursor-pointer disabled:opacity-40 text-primary-700 dark:text-primary-300 hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <Button
          tooltip="Forward"
          tooltipPosition="bottom"
          onClick={handleForward}
          disabled={!nav.canGoForward}
          className="p-0.5 rounded-full cursor-pointer disabled:opacity-40 text-primary-700 dark:text-primary-300 hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
          aria-label="Forward"
        >
          <ChevronLeft className="size-5 rotate-180" />
        </Button>
        <Button
          tooltip={nav.isLoading ? "Stop" : "Reload"}
          tooltipPosition="bottom"
          onClick={handleReload}
          className="group p-1 rounded-full cursor-pointer text-primary-700 dark:text-primary-300 hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
          aria-label={nav.isLoading ? "Stop" : "Reload"}
        >
          {nav.isLoading ? (
            <Close className="size-4 origin-center transition-transform duration-200 ease-out group-active:rotate-90" />
          ) : (
            <Refresh className="size-4 origin-center rotate-180 transition-transform duration-200 ease-out group-active:rotate-90" />
          )}
        </Button>
        </div>
        <Input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="Enter URL or search"
          className="flex-1 min-w-0 text-xs rounded-full py-1.75  text-primary-900 dark:text-primary-100 placeholder:text-primary-500 outline-none focus:bg-primary-200/60 dark:focus:bg-primary-800/60"
          spellCheck={false}
        />
        <div className="flex items-center gap-1 rounded-full glass-outline p-0.5">
        <Button
          tooltip={selectMode ? "Exit select mode (Esc)" : "Select in browser"}
          tooltipPosition="bottom-left"
          onClick={handleToggleSelect}
          className={`p-1 rounded-full cursor-pointer transition-colors ${
            selectMode
              ? "bg-primary-500/20 text-primary-800 dark:text-primary-200"
              : "text-primary-700 dark:text-primary-300 hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
          }`}
          aria-label={selectMode ? "Exit select mode" : "Select in browser"}
          aria-pressed={selectMode}
        >
          <Crop className="size-4" />
        </Button>
        <Button
          tooltip="Close browser"
          tooltipPosition="bottom-left"
          onClick={handleClose}
          className="p-1 rounded-full cursor-pointer text-primary-700 dark:text-primary-300 hover:bg-primary-200/60 dark:hover:bg-primary-800/60"
          aria-label="Close browser"
        >
          <Close className="size-4" />
        </Button>
        </div>
      </div>

      {/* Title bar */}
      <Text as="div" size="xxs" tone="subtle" className="px-3 py-1 -mb-px truncate border-b border-primary-200/40 dark:border-primary-800/40">
        {nav.title || nav.url || "New tab"}
      </Text>

      {/* Viewport */}
      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden mb-px"
      >
        {!nav.url && (
          <Text as="div" size="xs" tone="subtle" className="absolute inset-0 flex items-center justify-center pointer-events-none">
            Enter a URL above to get started
          </Text>
        )}
        {selectMode && (
          <div className="absolute left-1/2 top-2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-primary-500/90 text-primary-100 text-t font-medium shadow pointer-events-none">
            Click an element to capture · Esc to cancel
          </div>
        )}
      </div>
    </div>
  );
}
