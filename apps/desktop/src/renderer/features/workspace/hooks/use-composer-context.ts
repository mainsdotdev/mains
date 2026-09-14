import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  addContextItem,
  clearContextItems,
  removeContextItem,
} from "@/lib/redux/slices/workspaceSlice";
import {
  contextItemKey,
  groupContextItems,
  type ContextBrowserItem,
  type ContextItem,
} from "@/features/workspace/lib/composer-context";

/**
 * Detaching a browser selection frees its screenshots, which live as real files
 * under `userData/browser-captures`. Doing it here rather than at the one call
 * site that used to means no caller can drop a selection and leak its captures.
 */
function releaseBrowserCaptures(sel: ContextBrowserItem) {
  const api = (window as any).api?.browser;
  if (!api?.deleteCapture) return;
  if (sel.screenshotCaptureName) {
    api.deleteCapture(sel.screenshotCaptureName).catch(() => {});
  }
  if (sel.surroundingScreenshotCaptureName) {
    api.deleteCapture(sel.surroundingScreenshotCaptureName).catch(() => {});
  }
}

/**
 * The composer's attached context: the flat list, the per-kind views the UI
 * renders from, and the three ways to change it.
 *
 * This is the read path — calling it subscribes the component to every context
 * change. Somewhere that only *attaches* (the file explorer, the code viewer,
 * the browser panel) should keep dispatching `addContextItem` directly rather
 * than re-rendering on context it never shows.
 */
export function useComposerContext() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((state) => state.workspace.contextItems);
  const grouped = useMemo(() => groupContextItems(items), [items]);

  const add = useCallback(
    (item: ContextItem) => {
      dispatch(addContextItem(item));
    },
    [dispatch],
  );

  const remove = useCallback(
    (item: ContextItem) => {
      dispatch(removeContextItem({ kind: item.kind, key: contextItemKey(item) }));
      if (item.kind === "browser") releaseBrowserCaptures(item);
    },
    [dispatch],
  );

  const clear = useCallback(() => {
    dispatch(clearContextItems());
  }, [dispatch]);

  return { items, ...grouped, add, remove, clear };
}
