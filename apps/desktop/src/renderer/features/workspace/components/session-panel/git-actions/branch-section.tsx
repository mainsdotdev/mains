import { useCallback, useEffect, useRef, useState } from "react";
import { Branch, Check, Close, Plus, Refresh } from "@/components/ui/icons";
import { Alert, Input, Text, toast } from "@/components/ui";
import {
  useCreateWorkspaceBranchMutation,
  useGetWorkspaceQuery,
  useListProjectBranchesQuery,
  useSwitchWorkspaceBranchMutation,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { PanelItem, PanelCollapse, PANEL_ROW_X } from "../panel-item";
import type { GitActionsPanel } from "./use-git-actions-panel";

/**
 * The checked-out branch, the repo's other branches to switch to, and the form
 * that forks a new one off it.
 *
 * Both queries are scoped to the row being open: `git branch` on a large repo
 * isn't free, and the panel is opened far more often than this row is.
 */
export function BranchSection({ panel }: { panel: GitActionsPanel }) {
  const {
    workspaceId,
    status,
    hasChanges,
    changedFiles,
    refreshStatus,
    isSectionOpen,
    toggleSection,
    closeSection,
    pending,
    setPending,
    busy,
  } = panel;
  const isOpen = isSectionOpen("branch");
  const isCreating = isSectionOpen("newBranch");

  /** Branch being checked out, and the one held for confirmation. */
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [confirmBranch, setConfirmBranch] = useState<string | null>(null);

  // The branch list comes from the project's repo — a worktree workspace shares
  // its refs, so the names are the same either way.
  const { data: workspace } = useGetWorkspaceQuery(workspaceId);
  const projectId = workspace?.projectId ?? null;
  const { data: branchNames, isFetching: branchesFetching } =
    useListProjectBranchesQuery(projectId!, { skip: !projectId || !isOpen });
  const branches = branchNames ?? [];

  const [switchWorkspaceBranch] = useSwitchWorkspaceBranchMutation();

  /** The new branch's name, and the field that takes it. */
  const [newBranchName, setNewBranchName] = useState("");
  const newBranchInputRef = useRef<HTMLInputElement>(null);
  const [createWorkspaceBranch] = useCreateWorkspaceBranchMutation();

  // The form is opened by a deliberate click on a single-field form; landing in
  // the field is the only thing that click can have meant. (It can't autoFocus:
  // `PanelCollapse` renders its children while closed.)
  //
  // `preventScroll` because the row is still mid-collapse when this runs: a
  // plain focus makes the panel's own scroll container jump to "reveal" a field
  // whose height is still animating, which reads as the form sliding in late.
  useEffect(() => {
    if (isCreating) newBranchInputRef.current?.focus({ preventScroll: true });
  }, [isCreating]);

  /**
   * Fork a branch off the current HEAD and land on it. Uncommitted work comes
   * along by definition — the commit doesn't move, only the name pointing at
   * it — so unlike a switch there's nothing to warn about first.
   */
  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim();
    if (!name || pending) return;
    // Read before the mutation: this is the branch being forked from, and the
    // one the workspace will target from now on.
    const parent = status?.branch;
    setPending("newBranch");
    try {
      await createWorkspaceBranch({ workspaceId, branch: name }).unwrap();
      toast.success(
        parent
          ? `Created ${name} — pull requests will target ${parent}`
          : `Created and switched to ${name}`,
      );
      setNewBranchName("");
      closeSection("newBranch");
      refreshStatus();
    } catch (err) {
      // git owns branch naming: "already exists" and "not a valid branch name"
      // are its refusals, and they say more than a re-derived check would.
      toast.error(extractErrorMessage(err, `Could not create ${name}.`));
    } finally {
      setPending(null);
    }
  }, [
    workspaceId,
    newBranchName,
    status?.branch,
    pending,
    setPending,
    createWorkspaceBranch,
    closeSection,
    refreshStatus,
  ]);

  const runBranchSwitch = useCallback(
    async (branch: string) => {
      if (switchingBranch) return;
      setSwitchingBranch(branch);
      try {
        await switchWorkspaceBranch({ workspaceId, branch }).unwrap();
        toast.success(`Switched to ${branch}`);
        refreshStatus();
      } catch (err) {
        // git refuses a checkout that would overwrite local work, or one whose
        // branch is checked out in another worktree. Its message says which.
        toast.error(extractErrorMessage(err, `Could not switch to ${branch}.`));
      } finally {
        setSwitchingBranch(null);
        setConfirmBranch(null);
      }
    },
    [workspaceId, switchingBranch, switchWorkspaceBranch, refreshStatus],
  );

  /**
   * Uncommitted work travels with a checkout — or blocks it, if the target
   * branch touches the same files. Neither is obvious from a branch list, so a
   * dirty tree asks first; a clean one just switches.
   */
  const handleBranchClick = useCallback(
    (branch: string) => {
      if (branch === status?.branch) return;
      if (hasChanges) {
        setConfirmBranch(branch);
        return;
      }
      runBranchSwitch(branch);
    },
    [status?.branch, hasChanges, runBranchSwitch],
  );

  return (
    <>
      <PanelItem
        icon={<Branch className="size-4" />}
        label={status?.branch || "—"}
        expandable
        expanded={isOpen}
        onClick={() => toggleSection("branch")}
        // Nothing to list without a project: the branch names come from the
        // project's repo, which a worktree workspace shares refs with.
        disabled={!projectId}
        title={
          projectId ? "Show the repo's branches" : "This workspace has no project"
        }
        // Branching needs no project — it forks whatever this checkout has —
        // so the action stays live even when the branch list can't be listed.
        // Open, it becomes the form's own close button and stops hiding.
        hoverAction={{
          icon: isCreating ? (
            <Close className="size-4" />
          ) : (
            <Plus className="size-4" />
          ),
          onClick: () => toggleSection("newBranch"),
          title: isCreating
            ? "Close"
            : status?.branch
              ? `New branch from ${status.branch}`
              : "New branch",
          pending: pending === "newBranch",
          pinned: isCreating,
        }}
      />

      <PanelCollapse isOpen={isCreating}>
        <div className={`space-y-2 pt-2 pb-1 ${PANEL_ROW_X}`}>
          <Input
            ref={newBranchInputRef}
            type="text"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateBranch();
              }
            }}
            placeholder="New branch name…"
            className="w-full text-xs"
          />
        </div>
        <PanelItem
          icon={<Branch className="size-4" />}
          label="Create branch"
          onClick={handleCreateBranch}
          disabled={busy || !newBranchName.trim()}
          loading={pending === "newBranch"}
          title={
            hasChanges
              ? `${changedFiles} uncommitted file${
                  changedFiles === 1 ? "" : "s"
                } come along to the new branch.`
              : undefined
          }
        />
      </PanelCollapse>

      <PanelCollapse isOpen={isOpen}>
        <div className="max-h-56 overflow-y-auto noscrollbar">
          {branchesFetching && branches.length === 0 ? (
            <PanelItem
              icon={<Refresh className="size-4 animate-spin" />}
              label={
                <Text as="span" size="inherit" tone="faint" weight="normal">
                  Loading…
                </Text>
              }
            />
          ) : (
            branches.map((branch) => {
              const isCurrent = branch === status?.branch;
              return (
                <PanelItem
                  key={branch}
                  icon={<Branch className="size-4" />}
                  label={branch}
                  title={
                    isCurrent
                      ? `${branch} — already checked out`
                      : `Switch to ${branch}`
                  }
                  onClick={isCurrent ? undefined : () => handleBranchClick(branch)}
                  disabled={switchingBranch !== null}
                  loading={switchingBranch === branch}
                  // The checkout it's on, marked rather than offered again.
                  trailing={isCurrent ? <Check className="size-3.5" /> : undefined}
                />
              );
            })
          )}
        </div>
      </PanelCollapse>

      <Alert
        isOpen={!!confirmBranch}
        title={`Switch to ${confirmBranch ?? ""}?`}
        description={`${changedFiles} uncommitted file${
          changedFiles === 1 ? "" : "s"
        } will come along to ${confirmBranch ?? ""}. Git refuses the switch outright if that branch touches the same files.`}
        primaryButtonText="Switch"
        secondaryButtonText="Cancel"
        primaryButtonVariant="primary"
        onPrimary={() => confirmBranch && runBranchSwitch(confirmBranch)}
        onSecondary={() => setConfirmBranch(null)}
        isPrimaryLoading={switchingBranch !== null}
      />
    </>
  );
}
