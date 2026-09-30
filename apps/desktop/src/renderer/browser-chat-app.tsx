import { useEffect, useLayoutEffect, useState } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ErrorBoundary, Toaster } from "@/components/ui";
import { ReduxProvider } from "@/providers/redux-provider";
import { KeyboardShortcutsProvider } from "@/providers/keyboard-shortcuts-provider";
import { BrowserChatWindowProvider, useBrowserPanel } from "@/hooks/use-browser-panel";
import { ActiveSpaceOverrideProvider } from "@/hooks/use-active-space";
import { WorkspaceProviderPage } from "@/features/workspace/components/workspace-provider-page";
import { getProviderVariantById } from "@/lib/provider-variants";
import { useAppDispatch } from "@/lib/redux/hooks";
import { persistor } from "@/lib/redux";
import {
  setActiveTab,
  setDraftText,
  setSelectedCollectionId,
  setWorkspaceModel,
  setContextItemsForKey,
} from "@/lib/redux/slices/workspaceSlice";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import { deserializeBrowserChatUploads } from "@/features/workspace/lib/upload-bridge";
import { setTransientUploadsForOwner } from "@/features/workspace/hooks/use-transient-uploads";
import { isBrowserChatInteractiveTarget } from "@/features/workspace/lib/browser-chat-pointer";
import type { BrowserChatContext } from "../shared/browser-chat-window";

// Both renderers read the same saved UI state on boot. Only the main renderer
// may write it; a second redux-persist writer would race drafts and tab state.
persistor.pause();

function ChatHost() {
  const { setChatHost } = useBrowserPanel();
  return <div ref={setChatHost} className="pointer-events-none absolute inset-0" />;
}

function SyncContext({ context }: { context: BrowserChatContext }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();

  useLayoutEffect(() => {
    if (location.pathname !== context.route) navigate(context.route, { replace: true });
  }, [context.route, location.pathname, navigate]);

  useLayoutEffect(() => {
    if (location.pathname !== context.route) return;
    dispatch(setActiveTab(context.activeTab));
    dispatch(setWorkspaceModel({ providerId: context.providerId, model: context.selectedModel }));
    dispatch(setSelectedCollectionId(context.selectedCollectionId));
    dispatch(setContextItemsForKey({ key: context.ownerKey, items: context.contextItems as ContextItem[] }));
  }, [
    context.activeTab, context.contextItems, context.ownerKey, context.providerId,
    context.route, context.selectedCollectionId, context.selectedModel,
    dispatch, location.pathname,
  ]);

  // The child owns live typing. Parent context messages echo the previous
  // keystroke asynchronously, so applying each echo would undo fast typing.
  // A different composer owner starts from its saved draft in the main window.
  useLayoutEffect(() => {
    dispatch(setDraftText({ key: context.ownerKey, text: context.draft }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.ownerKey, dispatch]);

  useLayoutEffect(() => {
    setTransientUploadsForOwner(
      context.ownerKey,
      deserializeBrowserChatUploads(context.uploads),
    );
  // The payload is cloned on every context message. Only a new upload version
  // should replace File objects and revoke their image preview URLs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.ownerKey, context.uploadsVersion]);

  const variant = getProviderVariantById(context.providerId)?.variant;
  if (!variant) return null;
  return (
    <BrowserChatWindowProvider context={context}>
      <ChatHost />
      <Routes>
        <Route path="/code" element={<WorkspaceProviderPage providerId={context.providerId} variant={variant} browserChatOnly />} />
        <Route path="/code/runs/:runId" element={<WorkspaceProviderPage providerId={context.providerId} variant={variant} browserChatOnly />} />
        <Route path="/code/:workspaceId" element={<WorkspaceProviderPage providerId={context.providerId} variant={variant} browserChatOnly />} />
      </Routes>
    </BrowserChatWindowProvider>
  );
}

function usePassThroughMouse() {
  useEffect(() => {
    let last: "card" | "portal" | "none" | null = null;
    const update = (region: "card" | "portal" | "none") => {
      if (last === region) return;
      last = region;
      void window.api.browserChat.setInteractive(region !== "none");
    };
    const onMove = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      update(element?.closest("[data-floating-chat-surface]")
        ? "card"
        : isBrowserChatInteractiveTarget(element, document) ? "portal" : "none");
    };
    const onLeave = () => update("none");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      update("none");
    };
  }, []);
}

function applyParentTheme(context: BrowserChatContext) {
  const root = document.documentElement;
  root.classList.toggle("dark", context.dark);
  root.style.cssText = context.rootStyle;
  let style = document.getElementById("mains-app-theme");
  if (!context.themeCss) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = "mains-app-theme";
    document.head.appendChild(style);
  }
  if (style.textContent !== context.themeCss) style.textContent = context.themeCss;
}

export default function BrowserChatApp() {
  const [context, setContext] = useState<BrowserChatContext | null>(null);
  usePassThroughMouse();

  useEffect(() => {
    let disposed = false;
    let receivedEvent = false;
    const off = window.api.browserChat.onContext((next) => {
      if (!disposed) {
        receivedEvent = true;
        setContext(next);
      }
    });
    void window.api.browserChat.getContext().then((response) => {
      if (!disposed && !receivedEvent && response?.success && response.data) {
        setContext(response.data);
      }
    });
    return () => {
      disposed = true;
      off();
    };
  }, []);

  useLayoutEffect(() => {
    if (context) applyParentTheme(context);
  }, [context]);

  if (!context) return null;
  return (
    <ErrorBoundary level="app">
      <ReduxProvider>
        <ActiveSpaceOverrideProvider space={context.activeSpace}>
          <MemoryRouter initialEntries={[context.route]}>
            <KeyboardShortcutsProvider>
              <SyncContext context={context} />
              <Toaster />
            </KeyboardShortcutsProvider>
          </MemoryRouter>
        </ActiveSpaceOverrideProvider>
      </ReduxProvider>
    </ErrorBoundary>
  );
}
