import type { PrMergeMethod, PrRefInput, PullRequestDetail } from "@/lib/redux/api/pullRequestsApi";
import { pullRequestKey } from "./pull-request-link";

export type PrAction =
  | { kind: "merge"; method: PrMergeMethod }
  | { kind: "ready" }
  | { kind: "comment"; body: string }
  | { kind: "resolve"; threadId: string; resolved: boolean }
  | { kind: "reply"; threadId: string; body: string }
  | { kind: "review"; path: string; line: number; side: "left" | "right"; body: string };

export interface PrActionContext {
  prRef: PrRefInput;
  detail?: PullRequestDetail;
  active: boolean;
  isError: boolean;
  isFetching: boolean;
}

/** Provider permissions remain authoritative; summaries never authorize writes. */
export function allowsPrAction(context: PrActionContext, action: PrAction): boolean {
  const { detail, prRef, active, isError, isFetching } = context;
  if (!active || isError || isFetching || !detail || pullRequestKey(prRef) !== pullRequestKey({
    provider: detail.provider, owner: detail.repo.owner, repo: detail.repo.repo, number: detail.number,
  })) return false;
  switch (action.kind) {
    case "merge": return detail.state === "open" && !detail.isDraft && detail.mergeable === "MERGEABLE";
    case "ready": return detail.state === "open" && detail.isDraft && detail.viewerCanUpdate && !!detail.nodeId;
    case "comment": return !!action.body.trim();
    case "review": return !!action.body.trim() && !!action.path && Number.isSafeInteger(action.line) && action.line > 0;
    case "reply": return !!action.body.trim() && detail.reviewThreads.some((thread) => thread.id === action.threadId);
    case "resolve": return detail.reviewThreads.some((thread) => thread.id === action.threadId &&
      thread.isResolved !== action.resolved && (action.resolved ? thread.viewerCanResolve : thread.viewerCanUnresolve));
  }
}

/** A mounted detail owner admits one write synchronously. Hidden views retain
 * accepted work; replaced/closed views permanently lose publication rights. */
export function createPullRequestLifecycle(initial: PrActionContext, isCurrent: () => boolean) {
  let context = initial;
  let attached = false, retired = false, version = 0;
  let pending: { action: PrAction } | undefined;
  let merged = false, ready = false;
  const resolved = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  const publish = () => { version++; for (const listener of listeners) listener(); };
  const current = () => attached && !retired && isCurrent();
  const can = (action: PrAction, view = context) => {
    if (!current() || pending || !allowsPrAction(view, action)) return false;
    if ((action.kind === "merge" && merged) || (action.kind === "ready" && ready)) return false;
    if (action.kind === "resolve" && resolved.has(action.threadId)) {
      const expected = resolved.get(action.threadId);
      const thread = view.detail?.reviewThreads.find((thread) => thread.id === action.threadId);
      if (thread?.isResolved !== expected) return false;
    }
    return true;
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => version,
    attach() { attached = true; },
    detach() { attached = false; pending = undefined; },
    interrupt() {
      if (!attached || retired) return false;
      pending = undefined; publish(); return true;
    },
    retire() { retired = true; pending = undefined; publish(); },
    observe(next = context) {
      context = next;
      const { detail, isError, isFetching } = context;
      if (!current() || !detail || isError || isFetching) return;
      let changed = false;
      if (ready && !detail.isDraft) { ready = false; changed = true; }
      for (const [id, expected] of resolved) {
        const thread = detail.reviewThreads.find((thread) => thread.id === id);
        if (!thread || thread.isResolved === expected) { resolved.delete(id); changed = true; }
      }
      if (changed) publish();
    },
    can,
    pending: () => pending?.action,
    begin(action: PrAction) {
      if (!can(action)) return;
      const ticket = { action };
      pending = ticket;
      publish();
      return {
        current: () => current() && pending === ticket,
        visible: () => current() && pending === ticket && context.active,
        succeed() {
          if (!current() || pending !== ticket) return false;
          if (action.kind === "merge") merged = true;
          if (action.kind === "ready") ready = true;
          if (action.kind === "resolve") resolved.set(action.threadId, action.resolved);
          return true;
        },
        finish() { if (pending === ticket) { pending = undefined; publish(); } },
      };
    },
  };
}

/** A successful receipt acknowledges a version, not merely matching text (ABA). */
export function createPullRequestDraft() {
  let text = "", revision = 0, generation = 0, attached = false;
  const listeners = new Set<() => void>();
  const edit = (value: string) => {
    text = value; revision++;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => text,
    attach() { attached = true; generation++; },
    detach() { attached = false; generation++; },
    edit,
    invalidate() { revision++; },
    capture() {
      const sent = { body: text, revision, generation };
      return {
        body: sent.body,
        acknowledge() {
          if (!attached || generation !== sent.generation || revision !== sent.revision) return false;
          edit(""); return true;
        },
      };
    },
  };
}
