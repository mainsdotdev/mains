/**
 * What the five git-action sections genuinely share: the working-tree status
 * they all read, the accordion that decides which of them is open, and the
 * single in-flight action that disables the rest.
 *
 * Everything else — a commit message, a branch being checked out, the publish
 * form — belongs to one section and lives there. The rule for this file is
 * "more than one section needs it".
 */

import { useCallback, useEffect, useState } from "react";
import { useGetGitFlowStatusQuery, type GitFlowStatus } from "@/lib/redux/api";
import { appEvents } from "@/lib/transport";

/** The action currently in flight, or null. Only one at a time, panel-wide. */
export type PendingAction =
  | "commit"
  | "commitPush"
  | "push"
  | "pull"
  | "pr"
  | "publish"
  | "newBranch"
  | null;

/**
 * The panel rows that open in place. `newBranch` is the odd one out: it has no
 * row of its own, it's the form the branch row's own action opens under it.
 */
export type Section =
  | "changes"
  | "branch"
  | "newBranch"
  | "commit"
  | "pr"
  | "publish";

// Commit and PR are mutually exclusive — both forms answer "what happens to
// my changes next", so opening one closes the other. The rest stack freely.
const EXCLUSIVE_WITH: Partial<Record<Section, Section>> = {
  commit: "pr",
  pr: "commit",
};

/**
 * Whether a section is still usable given a status. A row that turns unusable
 * closes its own accordion: after a commit+push or a full revert its row goes
 * disabled, and a disabled row can't be clicked — the open form would otherwise
 * stick until the panel is reopened. Mirrors each row's `disabled` rule.
 */
function sectionStillUsable(section: Section, status: GitFlowStatus): boolean {
  const hasChanges = (status.changedFiles ?? 0) > 0;
  const canPush = (status.ahead ?? 0) > 0 || !status.hasUpstream;
  const hasRemote = status.hasRemote ?? true;
  const onDefault = status.isDefaultBranch ?? false;
  switch (section) {
    case "changes":
      return hasChanges;
    case "commit":
      return hasChanges || canPush;
    case "pr":
      return hasRemote && !onDefault;
    case "publish":
      return !hasRemote;
    default:
      return true;
  }
}

export function useGitActionsPanel(workspaceId: string) {
  const [openSections, setOpenSections] = useState<Section[]>([]);
  const [pending, setPending] = useState<PendingAction>(null);

  const { data: status, refetch } = useGetGitFlowStatusQuery(workspaceId, {
    // Pull fresh status each time the panel opens, so reopening after a
    // commit/push (or any external working-tree change) never shows stale
    // cached numbers.
    refetchOnMountOrArgChange: true,
  });

  const isSectionOpen = useCallback(
    (section: Section) => openSections.includes(section),
    [openSections],
  );

  const toggleSection = useCallback((section: Section) => {
    setOpenSections((prev) => {
      if (prev.includes(section)) return prev.filter((s) => s !== section);
      const rival = EXCLUSIVE_WITH[section];
      return [...(rival ? prev.filter((s) => s !== rival) : prev), section];
    });
  }, []);

  const closeSection = useCallback((section: Section) => {
    setOpenSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : prev,
    );
  }, []);

  // Every status refresh funnels through here so stale accordions close as
  // soon as the fresh state lands, whatever triggered the change.
  const refreshStatus = useCallback(async () => {
    const res = await refetch();
    const fresh = res.data;
    if (!fresh) return;
    setOpenSections((prev) => {
      const next = prev.filter((s) => sectionStillUsable(s, fresh));
      return next.length === prev.length ? prev : next;
    });
  }, [refetch]);

  // Live counts during a run: the run session recomputes the workspace diff
  // whenever a file-touching tool finishes and broadcasts it. getGitFlowStatus
  // is deliberately not WorkspaceDiffs-tagged (that invalidation cascades into
  // a resync), so it's refetched straight off the same signal. Coalesced,
  // because status runs its own diff snapshot and a burst of edits shouldn't
  // queue one per event.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = appEvents.runs.onDiffUpdated((event) => {
      if (event.workspaceId !== workspaceId || timer) return;
      timer = setTimeout(() => {
        timer = null;
        refreshStatus();
      }, 400);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, refreshStatus]);

  return {
    workspaceId,
    status,
    refreshStatus,
    isSectionOpen,
    toggleSection,
    closeSection,
    pending,
    setPending,
    busy: pending !== null,

    // Derived working-tree facts, defaulted in one place so every section
    // reads the same answer.
    additions: status?.additions ?? 0,
    deletions: status?.deletions ?? 0,
    changedFiles: status?.changedFiles ?? 0,
    changedFilePaths: status?.files ?? [],
    hasChanges: (status?.changedFiles ?? 0) > 0,
    canPush: (status?.ahead ?? 0) > 0 || (status ? !status.hasUpstream : false),
    // Behind is only as fresh as the last fetch, so it decides what the Pull
    // row *shows*, never whether it can run — pulling is how it gets fresh.
    behind: status?.behind ?? 0,
    // Without an upstream there is nothing to pull from: the branch exists
    // only locally until it's pushed.
    hasUpstream: status?.hasUpstream ?? false,
    // Default to "has remote" until status loads so we don't flash the Publish
    // action for normal repos. Only a loaded status with hasRemote:false swaps
    // in the Publish flow (push/PR are impossible without a remote).
    hasRemote: status?.hasRemote ?? true,
    // On the default branch a PR can't be opened (default → default), so the
    // action is disabled. No prompt to branch — opening a PR is a deliberate
    // choice the user would have made via a worktree.
    isDefaultBranch: status?.isDefaultBranch ?? false,
  };
}

export type GitActionsPanel = ReturnType<typeof useGitActionsPanel>;
