import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "react-redux";
import { useLocation } from "react-router-dom";
import { CHANNELS } from "@mains/contracts/channels";
import type { RunPullRequestCreatedEvent } from "@mains/contracts/runs";
import type { RootState } from "@/lib/redux";
import { useAppSelector } from "@/lib/redux/hooks";
import { getTransport, onTransportChange } from "@/lib/transport";
import { pullRequestsApi, pullRequestDetailTag } from "@/lib/redux/api/pullRequestsApi";
import { openPreviewTab } from "@/lib/redux/slices/previewSlice";
import { setRightPanelOpen, setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { getRouteRunId } from "@/lib/route-utils";
import { runOwnerKey, workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";
import { pullRequestPreviewTab } from "../lib/pull-request-preview-tab";

/** One app-scoped live listener; history reads never create or activate PR tabs. */
export function useCreatedPullRequests() {
  const store = useStore<RootState>();
  const backendId = useAppSelector((state) => state.backends.activeBackendId ?? "local");
  const transport = useSyncExternalStore(onTransportChange, getTransport, getTransport);
  const { pathname } = useLocation();
  const path = useRef(pathname);
  useLayoutEffect(() => { path.current = pathname; }, [pathname]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    const off = transport.subscribe(CHANNELS.runs.pullRequestCreated, (payload) => {
      const state = store.getState();
      if (!alive || getTransport() !== transport || (state.backends.activeBackendId ?? "local") !== backendId) return;
      const event = payload as RunPullRequestCreatedEvent | null;
      if (!event || typeof event.runId !== "string" || !event.runId ||
          !Number.isSafeInteger(event.toolCallId) || event.toolCallId <= 0 ||
          !["developer", "work", "chat"].includes(event.mode) ||
          (event.workspaceId !== null && typeof event.workspaceId !== "string") || typeof event.url !== "string") return;
      const tab = pullRequestPreviewTab(event.url);
      if (!tab) return;
      const eventKey = JSON.stringify([backendId, event.runId, event.toolCallId]);
      if (seen.current.has(eventKey)) return;
      seen.current.add(eventKey);
      if (seen.current.size > 1024) seen.current.delete(seen.current.values().next().value!);

      const conversationKey = runOwnerKey(backendId, event.runId);
      const ownerKey = event.mode === "developer" && event.workspaceId
        ? workspaceBrowserExpansionKey(backendId, event.workspaceId) : conversationKey;
      const routeRunId = getRouteRunId(path.current);
      const onRunRoute = routeRunId ? routeRunId === event.runId
        : path.current === "/code" || (!!event.workspaceId && path.current === "/code/" + event.workspaceId);
      const workspace = state.workspace;
      const activate = onRunRoute && workspace.composerContextReady && workspace.composerContextKey === conversationKey &&
        (workspace.activeTab === event.runId || routeRunId === event.runId) &&
        (event.mode !== "developer" || workspace.activeWorkspaceId === event.workspaceId);
      store.dispatch(pullRequestsApi.util.invalidateTags(["PullRequests", pullRequestDetailTag(tab.prRef)]));
      if (activate) {
        store.dispatch(setRightPanelOpen(false));
        store.dispatch(setSessionPanelOpen(false));
      }
      store.dispatch(openPreviewTab({ ownerKey, tab, activate }));
    });
    return () => { alive = false; off(); };
  }, [store, backendId, transport]);
}
