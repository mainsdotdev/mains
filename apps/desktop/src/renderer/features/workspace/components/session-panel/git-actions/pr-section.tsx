import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Branch, Maximize, MinimizeView, PullRequest } from "@/components/ui/icons";
import {
  Input,
  Button,
  Modal,
  ModalHeader,
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

const PR_VIEW_TRANSITION_NAME = "pr-editor";

/**
 * Open a pull request from the checked-out branch. Offered only when the repo
 * has a remote; the Publish section takes this slot when it doesn't.
 */
export function PrSection({
  panel,
  providerId,
  onClose,
  onEditorOpenChange,
  onEditorTransitionEnd,
}: {
  panel: GitActionsPanel;
  providerId?: string;
  /** Closes the whole panel — a created PR dismisses it. */
  onClose: () => void;
  onEditorOpenChange: (open: boolean, transitioning: boolean) => void;
  onEditorTransitionEnd: () => void;
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
  const [editorOpen, setEditorOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const viewTransitionRef = useRef<ViewTransition | null>(null);
  const editorRestoredRef = useRef(true);
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
      viewTransitionRef.current?.skipTransition();
      editorRestoredRef.current = true;
      setEditorOpen(false);
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

  const moveEditor = useCallback(
    (open: boolean) => {
      viewTransitionRef.current?.skipTransition();
      editorRestoredRef.current = !open;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (typeof document.startViewTransition !== "function" || reducedMotion) {
        setEditorOpen(open);
        onEditorOpenChange(open, false);
        return;
      }

      const transition = document.startViewTransition(() => {
        flushSync(() => {
          setEditorOpen(open);
          onEditorOpenChange(open, true);
        });
      });
      viewTransitionRef.current = transition;
      const finish = () => {
        if (viewTransitionRef.current !== transition) return;
        viewTransitionRef.current = null;
        onEditorTransitionEnd();
      };
      void transition.finished.then(finish, finish);
    },
    [onEditorOpenChange, onEditorTransitionEnd],
  );

  // A refreshed git status can revoke the PR row while the dialog is open.
  // Restore the panel once; the stale dialog must not reopen if status changes
  // again before the user explicitly expands the form.
  useEffect(() => {
    if (!editorOpen || editorRestoredRef.current || (isOpen && !isDefaultBranch)) return;
    viewTransitionRef.current?.skipTransition();
    editorRestoredRef.current = true;
    onEditorOpenChange(false, false);
    if (isOpen) toggleSection("pr");
  }, [editorOpen, isOpen, isDefaultBranch, onEditorOpenChange, toggleSection]);

  const closeEditor = () => moveEditor(false);
  const isModalOpen = editorOpen && isOpen && !isDefaultBranch;

  // The same controlled fields move between the compact panel and the dialog.
  // Their values stay in PrSection, so closing the dialog keeps the draft.
  const renderFields = (expanded: boolean) => (
    <div
      className={
        expanded
          ? "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
          : `space-y-2 pt-2 pb-1 ${PANEL_ROW_X}`
      }
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Text
            as="span"
            size={expanded ? "sm" : "xs"}
            tone={expanded ? "muted" : "subtle"}
            weight={expanded ? "medium" : undefined}
            className="block truncate"
          >
            Open the pull request into
          </Text>
          {!expanded && (
            <Button
              ref={expandButtonRef}
              onClick={() => moveEditor(true)}
              aria-label="Expand PR view"
              tooltip="Expand PR view"
              tooltipPosition="top-left"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-primary-600 transition-colors hover:bg-primary-200/40 hover:text-primary-900 dark:text-primary-400 dark:hover:bg-primary/10 dark:hover:text-primary-100"
            >
              <Maximize aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>
        <Select
          value={base}
          options={baseOptions}
          onChange={setPickedBase}
          disabled={busy}
          size={expanded ? "md" : "sm"}
          placeholder="Repository default"
          aria-label="Base branch"
        />
      </div>
      <div className={expanded ? "space-y-2" : ""}>
        {expanded && (
          <Text as="span" size="sm" tone="muted" weight="medium" className="block">
            Title
          </Text>
        )}
        <div className="relative">
          <Input
            ref={expanded ? titleInputRef : undefined}
            type="text"
            aria-label="Pull request title"
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            placeholder={generatingPr ? "" : "PR title (leave blank to generate)…"}
            className={expanded ? "w-full text-sm" : "w-full text-xs"}
          />
          {generatingPr && !prTitle && (
            <ShinePlaceholder size={expanded ? "sm" : "xs"}>
              Generating PR title…
            </ShinePlaceholder>
          )}
        </div>
      </div>
      <div className={expanded ? "flex min-h-64 flex-1 flex-col gap-2" : ""}>
        {expanded && (
          <Text as="span" size="sm" tone="muted" weight="medium" className="block">
            Description
          </Text>
        )}
        <div className={expanded ? "relative flex min-h-56 flex-1" : "relative"}>
          <Textarea
            aria-label="Pull request description"
            value={prBody}
            onChange={(e) => setPrBody(e.target.value)}
            rows={expanded ? 12 : 4}
            placeholder={
              generatingPr ? "" : "Description (optional, leave blank to generate)…"
            }
            className={
              expanded
                ? "h-full min-h-56 w-full resize-none pb-12 text-sm leading-relaxed"
                : "w-full text-xs pb-8"
            }
          />
          {generatingPr && !prBody && (
            <ShinePlaceholder size={expanded ? "sm" : "xs"}>
              Generating description…
            </ShinePlaceholder>
          )}
          <GenerateButton
            onClick={handleGeneratePr}
            disabled={busy || generatingPr}
            generating={generatingPr}
            tooltip="Generate the title and description from the branch"
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PanelItem
        icon={<PullRequest className="size-4" />}
        label="Create pull request"
        expandable
        expanded={isOpen}
        onClick={() => {
          if (!editorRestoredRef.current) onEditorOpenChange(false, false);
          editorRestoredRef.current = true;
          setEditorOpen(false);
          toggleSection("pr");
        }}
        disabled={isDefaultBranch}
        title={
          isDefaultBranch
            ? "Already on the default branch — nothing to open a PR from."
            : undefined
        }
      />
      <PanelCollapse
        isOpen={isOpen}
        viewTransitionName={!isModalOpen ? PR_VIEW_TRANSITION_NAME : undefined}
      >
        {renderFields(false)}
        <div className={PANEL_ROW_X}>
          <CheckboxOption
            checked={prDraft}
            onChange={() => setPrDraft((v) => !v)}
            className="mb-1"
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
      <Modal
        isOpen={isModalOpen}
        onClose={closeEditor}
        initialFocusRef={titleInputRef}
        returnFocusRef={expandButtonRef}
        motion={
          typeof document.startViewTransition === "function" ||
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
            ? "none"
            : "command"
        }
        viewTransitionName={PR_VIEW_TRANSITION_NAME}
        className="h-176 w-full max-w-3xl text-primary-900 dark:text-primary-100 rounded-3xl"
      >
        <ModalHeader
          onClose={closeEditor}
          closeIcon={<MinimizeView aria-hidden="true" className="size-4.5 text-primary-500" />}
          closeLabel="Minimize PR view"
        >
          <PullRequest aria-hidden="true" className="size-4 shrink-0 text-primary-600 dark:text-primary-400" />
          <Text as="h3" size="base" tone="contrast" weight="medium">
            Create pull request
          </Text>
        </ModalHeader>
        {isModalOpen && renderFields(true)}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-4 ">
          <CheckboxOption
            checked={prDraft}
            onChange={() => setPrDraft((v) => !v)}
          >
            Create as draft
          </CheckboxOption>
          <div className="ml-auto flex items-center gap-2">

            <Button
              variant="submit"
              onClick={handleCreatePr}
              disabled={busy}
              isLoading={pending === "pr"}
            >
              Create pull request
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
