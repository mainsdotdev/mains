import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, toast } from "@/components/ui";
import { Refresh } from "@/components/ui/icons";
import { useMcpAppPanel, useMcpAppInstances, McpAppInstanceProvider } from "@/hooks/use-mcp-app-panel";
import { usePanelAnimation } from "@/hooks/use-panel-animation";
import { usePreviewTabLifecycle } from "@/hooks/use-preview-tab-lifecycle";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setPendingRunId } from "@/lib/redux/slices/workspaceSlice";
import { mcpAppConversationPath } from "../lib/mcp-app-panel";
import { mcpAppCompatibility } from "@/lib/mcp-app-extensions";
import { McpAppWorkspace } from "./mcp-app-workspace";

export const MCP_APP_IDLE_MS = 2 * 60 * 1000;

export function McpAppPanel() {
  const instances = useMcpAppInstances();
  return <>{instances.map((instance) => <McpAppInstanceProvider key={instance.document!.id} value={instance}>
    <AppContent />
  </McpAppInstanceProvider>)}</>;
}

function AppContent() {
  const panel = useMcpAppPanel();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const composerKey = useAppSelector((state) => state.workspace.composerContextKey);
  const setChatHost = panel?.setChatHost;
  const { isVisible } = usePanelAnimation(!!panel?.isOpen);
  const [reloadKey, reload] = useReducer((value: number) => value + 1, 0);
  const [startedDocumentId, setStartedDocumentId] = useState<string | null>(null);
  const beforeSuspend = useRef<(() => Promise<void>) | null>(null);
  const registerBeforeSuspend = useCallback((callback: () => Promise<void>) => {
    beforeSuspend.current = callback;
    return () => { if (beforeSuspend.current === callback) beforeSuspend.current = null; };
  }, []);
  const documentId = panel?.document?.id;
  const { register } = usePreviewTabLifecycle();
  useEffect(() => documentId ? register(documentId, async () => { await beforeSuspend.current?.(); }) : undefined, [documentId, register]);
  const currentDocument = useRef(documentId);
  useEffect(() => {
    currentDocument.current = documentId;
    return () => { currentDocument.current = undefined; };
  }, [documentId]);
  // A rail launch changes the conversation owner before the panel can be
  // shown. Latch its first visible render, then keep the canvas mounted.
  if (documentId && panel?.isOpen && isVisible && startedDocumentId !== documentId) {
    setStartedDocumentId(documentId);
  }
  useEffect(() => {
    if (panel?.isOpen || !startedDocumentId) return;
    // Conversation/draft/model context live in the panel provider. Widget
    // state is saved by the app bridge and supplied again on initialization.
    let canceled = false;
    const timer = setTimeout(() => {
      const teardown = beforeSuspend.current;
      if (!teardown) { setStartedDocumentId(null); return; }
      void teardown().then(() => {
        if (canceled && currentDocument.current === documentId) reload();
        else if (!canceled) setStartedDocumentId(null);
      }, (error) => {
        // A failed state save keeps the canvas alive rather than losing work.
        toast.error(error instanceof Error ? error.message : "Could not save app state");
      });
    }, MCP_APP_IDLE_MS);
    return () => { canceled = true; clearTimeout(timer); };
  }, [panel?.isOpen, startedDocumentId, documentId]);


  if (!panel?.document) return null;
  const app = panel.document.app;
  const interfaceUnsupported = !!mcpAppCompatibility(app).notice;


  return <div data-mcp-app-panel="" data-mcp-app-panel-visible={panel.isOpen ? "" : undefined}
    aria-label={`${app.name} app panel`} aria-hidden={!panel.isOpen} inert={!panel.isOpen}
    className="absolute inset-0 flex min-h-0 flex-col overflow-hidden" style={{ display: panel.isOpen ? undefined : "none" }}
    onPointerDownCapture={(event) => {
      if (interfaceUnsupported || !panel.isExpanded || panel.chatMode !== "details") return;
      if (!(event.target as Element).closest("[data-floating-chat-surface]")) panel.setChatMode("input");
    }}>
    <div className="flex shrink-0 items-center justify-end gap-1 border-b border-primary-200/60 px-2 py-1 dark:border-primary-800/50">
      {panel.ownerKey !== composerKey && <Button variant="ghost" className="text-xs" onClick={() => {
        if (panel.runId) dispatch(setPendingRunId(panel.runId));
        if (panel.scope) navigate(mcpAppConversationPath(panel.scope, panel.runId));
      }}>Open app conversation</Button>}
      <Button variant="icon" onClick={reload} tooltip="Reload app" aria-label="Reload app">
        <Refresh className="size-4" />
      </Button>
    </div>
    <div className="relative min-h-0 flex-1 isolate">
      {startedDocumentId === documentId && <McpAppWorkspace key={reloadKey} registerBeforeSuspend={registerBeforeSuspend} />}
      {!interfaceUnsupported && <div ref={setChatHost} className="pointer-events-none absolute inset-0 z-10" />}
    </div>
  </div>;
}
