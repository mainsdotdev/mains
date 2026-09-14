import { useCallback, useMemo, useState } from "react";
import { Branch, PullRequest } from "@/components/ui/icons";
import {
  Input,
  Select,
  Text,
  Textarea,
  toast,
  type SelectOption,
} from "@/components/ui";
import {
  useCreatePrGitFlowMutation,
  useGeneratePrBodyGitFlowMutation,
  useGetWorkspaceQuery,
  useListProjectBranchesQuery,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { PanelItem, PanelCollapse, PANEL_ROW_X } from "../panel-item";
import { CheckboxOption, GenerateButton, ShinePlaceholder } from "./controls";
import type { GitActionsPanel } from "./use-git-actions-panel";

/**
 * Open a pull request from the checked-out branch. Offered only when the repo
 * has a remote; the Publish section takes this slot when it doesn't.
 */
export function PrSection({
  panel,
  providerId,
  onClose,
}: {
  panel: GitActionsPanel;
  providerId?: string;
  /** Closes the whole panel — a created PR dismisses it. */
  onClose: () => void;
}) {
  const {
    workspaceId,
    status,
    isDefaultBranch,
    pending,
    setPending,
    busy,
    isSectionOpen,
    toggleSection,
  } = panel;
  const isOpen = isSectionOpen("pr");

  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prDraft, setPrDraft] = useState(false);
  /**
   * The base picked in this form. Empty means "whatever the workspace resolves
   * to" — the form doesn't pin a branch the user never touched, so a workspace
   * whose base changes underneath still opens against the right target.
   */
  const [pickedBase, setPickedBase] = useState("");

  // Same source as the branch row: the project's repo, whose refs a worktree
  // workspace shares. Scoped to the row being open — `git branch` isn't free.
  const { data: workspace } = useGetWorkspaceQuery(workspaceId);
  const projectId = workspace?.projectId ?? null;
  const { data: branchNames } = useListProjectBranchesQuery(projectId!, {
    skip: !projectId || !isOpen,
  });

  const headBranch = status?.branch ?? "";
  const resolvedBase = status?.baseBranch ?? "";
  // A pick that has become the checked-out branch is no pick at all: the branch
  // row can move HEAD while this form is open, and the select drops the head
  // from its options — the value it sends has to drop it too.
  const base = (pickedBase !== headBranch ? pickedBase : "") || resolvedBase;

  const baseOptions = useMemo(() => {
    const names = (branchNames ?? []).filter((name) => name !== headBranch);
    // The resolved base is what we default to, so it has to be selectable even
    // when it isn't in the list — it can live only on the remote, and the list
    // is still empty while the branches load.
    if (resolvedBase && resolvedBase !== headBranch && !names.includes(resolvedBase)) {
      names.unshift(resolvedBase);
    }
    // Only the closed trigger spells out the direction — `main ← dev`. In the
    // open list every row would repeat the same head branch, and the list is
    // already unambiguously a list of targets.
    const withHead = (target: string) =>
      headBranch ? `${target} ← ${headBranch}` : target;
    // The glyph rides the trigger only: down a list of nothing but branches it
    // distinguishes no row from another.
    const options: SelectOption[] = names.map((name) => ({
      value: name,
      label: name,
      selectedLabel: withHead(name),
      selectedIcon: <Branch className="size-3.5 shrink-0" />,
    }));
    // Nothing resolved: `gh` falls back to the remote's default branch, and
    // this entry says so rather than pretending a branch was chosen.
    if (!resolvedBase) {
      options.unshift({
        value: "",
        label: "Repository default",
        selectedLabel: withHead("Repository default"),
        selectedIcon: <Branch className="size-3.5 shrink-0" />,
        description: "Whatever the remote calls its default branch",
      });
    }
    return options;
  }, [branchNames, headBranch, resolvedBase]);

  const [createPrGitFlow] = useCreatePrGitFlowMutation();
  const [generatePrBody, { isLoading: generatingPr }] =
    useGeneratePrBodyGitFlowMutation();

  /** Explicit generation for the PR form — fills title + body. */
  const handleGeneratePr = useCallback(() => {
    if (!providerId || generatingPr) return;
    // Against the chosen base, so the description matches the PR's own diff.
    generatePrBody({ workspaceId, providerId, base: base || undefined })
      .unwrap()
      .then((generated) => {
        setPrTitle(generated.title);
        setPrBody(generated.body);
      })
      .catch((err) =>
        toast.error(extractErrorMessage(err, "Failed to generate the PR description.")),
      );
  }, [workspaceId, providerId, generatingPr, generatePrBody, base]);

  const handleCreatePr = useCallback(async () => {
    if (pending) return;
    setPending("pr");
    const toastId = toast.loading("Creating pull request…");
    try {
      const result = await createPrGitFlow({
        workspaceId,
        title: prTitle.trim() || undefined,
        body: prBody.trim() || undefined,
        base: base || undefined,
        draft: prDraft,
        providerId,
      }).unwrap();
      toast.success("Pull request created", { id: toastId });
      if (result.url) window.api.shell.openExternal(result.url);
      onClose();
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Failed to create PR", {
        id: toastId,
      });
    } finally {
      setPending(null);
    }
  }, [
    workspaceId,
    pending,
    setPending,
    createPrGitFlow,
    prTitle,
    prBody,
    prDraft,
    base,
    providerId,
    onClose,
  ]);

  return (
    <>
      <PanelItem
        icon={<PullRequest className="size-4" />}
        label="Create pull request"
        expandable
        expanded={isOpen}
        onClick={() => toggleSection("pr")}
        disabled={isDefaultBranch}
        title={
          isDefaultBranch
            ? "Already on the default branch — nothing to open a PR from."
            : undefined
        }
      />
      <PanelCollapse isOpen={isOpen}>
        <div className={`space-y-2 pt-2 pb-1 ${PANEL_ROW_X}`}>
          {/* Where the PR lands. "Merge … into" described the eventual merge,
              which this button doesn't perform — the row opens a PR. */}
          <div className="space-y-1.5">
            <Text as="span" size="xs" tone="subtle" className="block truncate">
              Open the pull request into
            </Text>
            <Select
              value={base}
              options={baseOptions}
              onChange={setPickedBase}
              disabled={busy}
              size="sm"
              placeholder="Repository default"
              aria-label="Base branch"
            />
          </div>
          {/* While the model writes, the waiting line shimmers instead of
              sitting there as a static placeholder. It only stands in for an
              empty field, exactly as a placeholder does. */}
          <div className="relative">
            <Input
              type="text"
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              placeholder={
                generatingPr ? "" : "PR title (leave blank to generate)…"
              }
              className="w-full text-xs"
            />
            {generatingPr && !prTitle && (
              <ShinePlaceholder>Generating PR title…</ShinePlaceholder>
            )}
          </div>
          <div className="relative">
            <Textarea
              value={prBody}
              onChange={(e) => setPrBody(e.target.value)}
              rows={4}
              placeholder={
                generatingPr
                  ? ""
                  : "Description (optional, leave blank to generate)…"
              }
              className="w-full text-xs pb-8"
            />
            {generatingPr && !prBody && (
              <ShinePlaceholder>Generating description…</ShinePlaceholder>
            )}
            <GenerateButton
              onClick={handleGeneratePr}
              disabled={busy || generatingPr}
              generating={generatingPr}
              tooltip="Generate the title and description from the branch"
            />
          </div>
          <CheckboxOption
            checked={prDraft}
            onChange={() => setPrDraft((v) => !v)}
            className="mb-1 -mt-1"
          >
            Create as draft
          </CheckboxOption>
        </div>
        <PanelItem
          icon={<PullRequest className="size-4" />}
          label="Create pull request"
          onClick={handleCreatePr}
          disabled={busy}
          loading={pending === "pr"}
        />
      </PanelCollapse>
    </>
  );
}
