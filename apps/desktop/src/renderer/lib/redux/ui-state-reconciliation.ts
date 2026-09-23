import { CHANNELS } from "@mains/contracts/channels";
import { isRunTab } from "@/features/workspace/lib/repo-utils";
import {
  runIdFromOwnerKey,
  viewKeyBelongsToBackend,
  workspaceIdFromDraftOwnerKey,
  workspaceIdFromViewKey,
} from "../../../shared/ui-state-keys";
import { getTransport, type Transport } from "../transport";
import type { AppDispatch, RootState } from "./index";
import { forgetDeletedUiContext, type DeletedUiContext } from "./ui-state-cleanup";

export function collectUiContextCandidates(
  state: RootState,
  backendId: string,
  browserOwnerKeys: string[],
): DeletedUiContext[] {
  const runs = new Set<string>();
  const workspaces = new Set<string>();
  const addOwner = (key: string) => {
    const runId = runIdFromOwnerKey(key, backendId);
    if (runId) runs.add(runId);
    const workspaceId = workspaceIdFromDraftOwnerKey(key, backendId);
    if (workspaceId) workspaces.add(workspaceId);
  };
  const addView = (key: string, activeTab?: string, previousTab?: string | null) => {
    const workspaceId = workspaceIdFromViewKey(key, backendId);
    if (workspaceId) workspaces.add(workspaceId);
    if (!viewKeyBelongsToBackend(key, backendId)) return;
    if (activeTab && isRunTab(activeTab)) runs.add(activeTab);
    if (previousTab && isRunTab(previousTab)) runs.add(previousTab);
  };

  for (const key of Object.keys(state.workspace.draftTextByKey)) addOwner(key);
  for (const key of Object.keys(state.workspace.contextItemsByKey)) addOwner(key);
  addOwner(state.workspace.composerContextKey);
  for (const key of Object.keys(state.appSettings.rightPaneByContext)) addOwner(key);
  for (const key of Object.keys(state.appSettings.documentViewerDocByContext)) addOwner(key);
  addOwner(state.appSettings.activeRightPaneContextKey);
  for (const key of browserOwnerKeys) addOwner(key);
  for (const [key, view] of Object.entries(state.workspace.workspaceViews)) {
    addView(key, view.activeTab, view.previousNonEditorTab);
  }
  if (state.workspace.workspaceViewKey) {
    addView(state.workspace.workspaceViewKey, state.workspace.activeTab, state.workspace.previousNonEditorTab);
  }

  return [
    ...Array.from(runs, (id) => ({ backendId, kind: "run" as const, id })),
    ...Array.from(workspaces, (id) => ({ backendId, kind: "workspace" as const, id })),
  ];
}

/** Check only IDs already named by persisted UI state; a paginated list is not proof of deletion. */
export async function reconcilePersistedUiState(
  dispatch: AppDispatch,
  getState: () => RootState,
  transport: Transport,
  backendId: string,
): Promise<void> {
  const stillConnected = () =>
    getTransport() === transport &&
    (getState().backends.activeBackendId ?? "local") === backendId &&
    transport.status() === "connected";
  if (!stillConnected()) return;

  let browserOwnerKeys: string[] = [];
  const browser = typeof window === "undefined" ? undefined : window.api?.browser;
  if (browser?.listOwnerKeys) {
    try {
      const result = await browser.listOwnerKeys();
      if (result.success && Array.isArray(result.data)) browserOwnerKeys = result.data;
    } catch {
      // The renderer still has its own records to check.
    }
  }
  if (!stillConnected()) return;
  const candidates = collectUiContextCandidates(getState(), backendId, browserOwnerKeys);

  // A missing result is authoritative only for a successful get-by-ID call.
  // Offline backends and failed calls leave local state untouched for retry.
  for (let start = 0; start < candidates.length && stillConnected(); start += 8) {
    await Promise.all(candidates.slice(start, start + 8).map(async (target) => {
      const channel = target.kind === "run" ? CHANNELS.runs.getById : CHANNELS.workspace.get;
      try {
        const result = await transport.invoke(channel, [target.id]);
        if (result.success && result.data === null && stillConnected()) {
          await forgetDeletedUiContext(dispatch, target);
        }
      } catch {
        // Retry on a later connection rather than guessing that it was deleted.
      }
    }));
  }
}
