import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  useMergePrMutation, useMarkPrReadyMutation, useAddPrCommentMutation,
  useResolvePrThreadMutation, useReplyToPrThreadMutation, useAddPrReviewCommentMutation,
  pullRequestsApi, pullRequestDetailTag,
} from "@/lib/redux/api/pullRequestsApi";
import { useAppDispatch } from "@/lib/redux/hooks";
import { getTransport, onTransportChange } from "@/lib/transport";
import { toast } from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { createPullRequestDraft, createPullRequestLifecycle, type PrAction, type PrActionContext } from "../lib/pull-request-lifecycle";

const messages: Record<PrAction["kind"], [string, string]> = {
  merge: ["Merged", "Failed to merge pull request"],
  ready: ["Marked as ready for review", "Failed to mark as ready"],
  comment: ["Comment posted", "Failed to post comment"],
  review: ["Comment posted", "Failed to post comment"],
  reply: ["", "Failed to post reply"],
  resolve: ["", "Failed to update review thread"],
};

export function usePullRequestActions(context: PrActionContext) {
  const dispatch = useAppDispatch();
  const [merge] = useMergePrMutation();
  const [ready] = useMarkPrReadyMutation();
  const [comment] = useAddPrCommentMutation();
  const [resolve] = useResolvePrThreadMutation();
  const [reply] = useReplyToPrThreadMutation();
  const [review] = useAddPrReviewCommentMutation();
  const latest = useRef(context);
  useLayoutEffect(() => { latest.current = context; });
  const [transport] = useState(getTransport);
  const [lifecycle] = useState(() => createPullRequestLifecycle(context,
    () => getTransport() === transport && transport.status() === "connected"));
  useSyncExternalStore(lifecycle.subscribe, lifecycle.snapshot);
  useLayoutEffect(() => {
    lifecycle.attach();
    const off = onTransportChange(() => lifecycle.retire());
    const offStatus = transport.onStatusChange((status) => {
      if (getTransport() !== transport || !lifecycle.interrupt()) return;
      if (status === "connected") dispatch(pullRequestsApi.util.invalidateTags([pullRequestDetailTag(latest.current.prRef)]));
    });
    return () => { off(); offStatus(); lifecycle.detach(); };
  }, [lifecycle, transport, dispatch]);
  useLayoutEffect(() => { lifecycle.observe(context); });

  return {
    can: (action: PrAction) => lifecycle.can(action, context),
    pending: lifecycle.pending(),
    async run(action: PrAction, onSuccess?: () => void) {
      const ticket = lifecycle.begin(action);
      if (!ticket) return;
      const { prRef, detail } = latest.current;
      try {
        switch (action.kind) {
          case "merge": await merge({ ...prRef, method: action.method }).unwrap(); break;
          case "ready": await ready({ ...prRef, nodeId: detail!.nodeId }).unwrap(); break;
          case "comment": await comment({ ...prRef, body: action.body.trim() }).unwrap(); break;
          case "resolve": await resolve({ ...prRef, threadId: action.threadId, resolved: action.resolved }).unwrap(); break;
          case "reply": await reply({ ...prRef, threadId: action.threadId, body: action.body.trim() }).unwrap(); break;
          case "review": await review({ ...prRef, path: action.path, line: action.line, side: action.side, body: action.body.trim() }).unwrap(); break;
        }
        if (!ticket.succeed()) return;
        onSuccess?.();
        const success = messages[action.kind][0];
        if (success && ticket.visible()) toast.success(action.kind === "merge" ? success + " #" + prRef.number : success);
      } catch (error) {
        if (ticket.visible()) toast.error(extractErrorMessage(error, messages[action.kind][1]));
      } finally { ticket.finish(); }
    },
  };
}

export type PullRequestActions = ReturnType<typeof usePullRequestActions>;
export const PullRequestActionsContext = createContext<PullRequestActions | null>(null);
export function usePrActions() {
  const actions = useContext(PullRequestActionsContext);
  if (!actions) throw new Error("PR actions require a detail view owner");
  return actions;
}

export function usePrDraft() {
  const [draft] = useState(createPullRequestDraft);
  const text = useSyncExternalStore(draft.subscribe, draft.snapshot);
  useLayoutEffect(() => { draft.attach(); return () => draft.detach(); }, [draft]);
  return { text, edit: draft.edit, invalidate: draft.invalidate, capture: draft.capture };
}
