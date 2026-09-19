import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  addContextItem,
  clearContextItems,
  removeContextItem,
} from "@/lib/redux/slices/workspaceSlice";
import {
  contextItemKey,
  groupContextItems,
  type ContextAppshotItem,
  type ContextBrowserItem,
  type ContextItem,
} from "@/features/workspace/lib/composer-context";

/**
 * Explicitly detaching capture-backed context frees its real files under
 * `userData/browser-captures`. Successfully sent captures are intentionally
 * left in the bounded capture cache: the provider session starts in the
 * background and may not have copied the source file when the composer clears.
 */
function releaseBrowserCaptures(sel: ContextBrowserItem) {
  const api = (window as any).api?.browser;
  if (!api?.deleteCapture) return;
  if (sel.screenshotCaptureName) {
    api.deleteCapture(sel.screenshotCaptureName).catch(() => {});
  }
}

function releaseAppshotCapture(appshot: ContextAppshotItem) {
  const api = (window as any).api?.appshots;
  if (!api?.deleteCapture) return;
  api.deleteCapture(appshot.screenshotCaptureName).catch(() => {});
}

function releaseOwnedCapture(item: ContextItem) {
  if (item.kind === "browser") releaseBrowserCaptures(item);
  if (item.kind === "appshot") releaseAppshotCapture(item);
}

/**
 * The composer's attached context: the flat list, the per-kind views the UI
 * renders from, its normal mutations, and the route-scoped reset.
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
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const add = useCallback(
    (item: ContextItem) => {
      dispatch(addContextItem(item));
    },
    [dispatch],
  );

  const remove = useCallback(
    (item: ContextItem) => {
      dispatch(removeContextItem({ kind: item.kind, key: contextItemKey(item) }));
      releaseOwnedCapture(item);
    },
    [dispatch],
  );

  const clear = useCallback(() => {
    dispatch(clearContextItems());
  }, [dispatch]);

  // Files, issues, and in-app selections belong to the route/workspace that
  // produced them. A global Appshot belongs to the next message, so it survives
  // opening the composer or switching workspaces until sent or removed.
  const resetForRoute = useCallback(() => {
    const retained = itemsRef.current.filter((item) => item.kind === "appshot");
    itemsRef.current
      .filter((item) => item.kind !== "appshot")
      .forEach(releaseOwnedCapture);
    dispatch(clearContextItems());
    retained.forEach((item) => dispatch(addContextItem(item)));
  }, [dispatch]);

  return { items, ...grouped, add, remove, clear, resetForRoute };
}
