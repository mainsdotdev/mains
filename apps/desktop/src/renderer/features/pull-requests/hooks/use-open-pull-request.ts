import { useCallback } from "react";
import { usePreviewPanel } from "@/hooks/use-preview-panel";
import { useAppDispatch } from "@/lib/redux/hooks";
import { openPreviewTab } from "@/lib/redux/slices/previewSlice";
import { pullRequestPreviewTab } from "../lib/pull-request-preview-tab";

/** Returns false when the URL or current surface cannot open a native PR preview. */
export function useOpenPullRequest() {
  const dispatch = useAppDispatch();
  const { ownerKey, canOpen, reveal } = usePreviewPanel();
  return useCallback((url: string): boolean => {
    const tab = pullRequestPreviewTab(url);
    if (!tab || !canOpen) return false;
    reveal();
    dispatch(openPreviewTab({ ownerKey, tab }));
    return true;
  }, [dispatch, ownerKey, canOpen, reveal]);
}
