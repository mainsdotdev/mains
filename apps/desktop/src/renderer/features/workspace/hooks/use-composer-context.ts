import { useCallback, useEffect, useMemo, useRef } from "react";
import { createSelector } from "@reduxjs/toolkit";
import { shallowEqual } from "react-redux";
import type { ReviewComment } from "@mains/contracts/review-comments";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { store, type RootState } from "@/lib/redux";
import {
  addContextItem,
  clearContextItems,
  removeContextItem,
  setContextItemsForKey,
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
  // An editor can detach a capture while the original queued input or saved
  // draft still owns it. Keep those pixels until that ownership is released.
  const queues = store.getState().runQueue?.byOwner ?? {};
  const key = contextItemKey(item);
  if (Object.values(queues).some((queue) => [...queue.messages.flatMap((message) => message.contextItems),
    ...(queue.draftBackup?.contextItems ?? [])].some((saved) => saved.kind === item.kind && contextItemKey(saved) === key))) return;
  if (item.kind === "browser") releaseBrowserCaptures(item);
  if (item.kind === "appshot") releaseAppshotCapture(item);
}

function syncBrowserChatContext() {
  if (typeof window === "undefined" ||
      !new URLSearchParams(window.location.search).has("browserChatOverlay")) return;
  const state = store.getState().workspace;
  void window.api.browserChat.postAction({
    type: "contextItems",
    ownerKey: state.composerContextKey,
    items: state.contextItems,
  });
}

/** The normal composer mutations, without subscribing to attached context. */
export function useComposerContextActions() {
  const dispatch = useAppDispatch();

  const add = useCallback(
    (item: ContextItem) => {
      dispatch(addContextItem(item));
      syncBrowserChatContext();
    },
    [dispatch],
  );

  const remove = useCallback(
    (item: ContextItem) => {
      dispatch(removeContextItem({ kind: item.kind, key: contextItemKey(item) }));
      syncBrowserChatContext();
      releaseOwnedCapture(item);
    },
    [dispatch],
  );

  const update = useCallback((item: ContextItem) => {
    const state = store.getState().workspace;
    const key = contextItemKey(item);
    dispatch(setContextItemsForKey({
      key: state.composerContextKey,
      items: state.contextItems.map((current) =>
        current.kind === item.kind && contextItemKey(current) === key ? item : current),
    }));
    syncBrowserChatContext();
  }, [dispatch]);

  const clear = useCallback(() => {
    dispatch(clearContextItems());
    syncBrowserChatContext();
  }, [dispatch]);

  return useMemo(() => ({ add, remove, update, clear }), [add, remove, update, clear]);
}

// A derived index of the existing context list, shared by all Review files.
// shallowEqual retains each reader's array when another file/context kind changes.
const EMPTY_REVIEW_COMMENTS: readonly ReviewComment[] = Object.freeze([]);
const selectReviewCommentIndex = createSelector(
  [(state: RootState) => state.workspace.contextItems],
  (items) => {
    const workspaces = new Map<string, { all: ReviewComment[]; files: Map<string, ReviewComment[]> }>();
    for (const item of items) {
      if (item.kind !== "review") continue;
      let workspace = workspaces.get(item.workspaceId);
      if (!workspace) {
        workspace = { all: [], files: new Map() };
        workspaces.set(item.workspaceId, workspace);
      }
      workspace.all.push(item);
      const comments = workspace.files.get(item.filePath) ?? [];
      comments.push(item);
      workspace.files.set(item.filePath, comments);
    }
    return workspaces;
  },
);

/** Review readers subscribe only to comments in their workspace or file. */
export function useComposerReviewComments(workspaceId: string, filePath?: string): readonly ReviewComment[] {
  return useAppSelector((state) => {
    const workspace = selectReviewCommentIndex(state).get(workspaceId);
    return (filePath === undefined ? workspace?.all : workspace?.files.get(filePath)) ?? EMPTY_REVIEW_COMMENTS;
  }, shallowEqual);
}

/** The full context read path, grouped views, mutations and route-scoped reset. */
export function useComposerContext() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((state) => state.workspace.contextItems);
  const grouped = useMemo(() => groupContextItems(items), [items]);
  const actions = useComposerContextActions();
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
    syncBrowserChatContext();
  }, [dispatch]);

  return { items, ...grouped, ...actions, resetForRoute };
}
