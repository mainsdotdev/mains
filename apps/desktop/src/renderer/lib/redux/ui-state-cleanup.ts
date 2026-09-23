import type { AppDispatch } from "./index";
import { forgetRunUiState, forgetWorkspaceUiState } from "./slices/workspaceSlice";
import { forgetRunRightPane, forgetWorkspaceRightPanes } from "./slices/appSettingsSlice";
import {
  clearTransientUploads,
  clearWorkspaceTransientUploads,
} from "@/features/workspace/hooks/use-transient-uploads";
import { runOwnerKey } from "../../../shared/ui-state-keys";

export interface DeletedUiContext {
  backendId: string;
  kind: "run" | "workspace";
  id: string;
}

/** Called only after the backend confirms permanent deletion. */
export async function forgetDeletedUiContext(dispatch: AppDispatch, target: DeletedUiContext): Promise<void> {
  if (target.kind === "run") {
    dispatch(forgetRunUiState({ backendId: target.backendId, runId: target.id }));
    dispatch(forgetRunRightPane({ backendId: target.backendId, runId: target.id }));
    clearTransientUploads(runOwnerKey(target.backendId, target.id));
  } else {
    dispatch(forgetWorkspaceUiState({ backendId: target.backendId, workspaceId: target.id }));
    dispatch(forgetWorkspaceRightPanes({ backendId: target.backendId, workspaceId: target.id }));
    clearWorkspaceTransientUploads(target.backendId, target.id);
  }

  // The embedded browser is desktop-only; its tabs live in the main process.
  const browser = typeof window === "undefined" ? undefined : window.api?.browser;
  if (!browser?.forgetContext) return;
  try {
    const result = await browser.forgetContext(target);
    if (!result.success) throw new Error(result.error);
  } catch (error) {
    // Redux state is already cleaned. Reconciliation retries native tabs on
    // the next launch or backend connection.
    console.error("Failed to forget browser context:", error);
  }
}
