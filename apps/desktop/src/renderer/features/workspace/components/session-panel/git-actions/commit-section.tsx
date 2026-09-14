import { useCallback, useRef, useState } from "react";
import { ArrowUp, Commit } from "@/components/ui/icons";
import { Textarea, toast } from "@/components/ui";
import {
  useCommitGitFlowMutation,
  usePushGitFlowMutation,
  useGenerateCommitMessageGitFlowMutation,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { PanelItem, PanelCollapse, PANEL_ROW_X } from "../panel-item";
import { CheckboxOption, GenerateButton } from "./controls";
import type { GitActionsPanel } from "./use-git-actions-panel";

/**
 * Commit, commit-and-push, and push — one form, because they all act on the
 * same message and the same "include unstaged" choice.
 */
export function CommitSection({
  panel,
  providerId,
}: {
  panel: GitActionsPanel;
  providerId?: string;
}) {
  const {
    workspaceId,
    hasChanges,
    canPush,
    hasRemote,
    pending,
    setPending,
    busy,
    refreshStatus,
    isSectionOpen,
    toggleSection,
  } = panel;

  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  /** Bumped on commit so an in-flight generation for the old changeset is dropped. */
  const prefillSeqRef = useRef(0);

  const [commitGitFlow] = useCommitGitFlowMutation();
  const [pushGitFlow] = usePushGitFlowMutation();
  const [generateCommitMessage, { isLoading: generatingMessage }] =
    useGenerateCommitMessageGitFlowMutation();

  /**
   * The Generate button: fills the textarea with a model-written message
   * (overwriting what's there — the click is deliberate). `preview: true` keeps
   * the index untouched; the seq guard drops a result that lands after a commit
   * already emptied the field.
   */
  const handleGenerateMessage = useCallback(() => {
    if (!providerId || generatingMessage) return;
    const seq = prefillSeqRef.current;
    generateCommitMessage({
      workspaceId,
      providerId,
      includeUnstaged,
      preview: true,
    })
      .unwrap()
      .then((generated) => {
        if (prefillSeqRef.current !== seq) return;
        setMessage(generated);
      })
      .catch((err) =>
        toast.error(extractErrorMessage(err, "Failed to generate a commit message.")),
      );
  }, [
    workspaceId,
    providerId,
    generatingMessage,
    includeUnstaged,
    generateCommitMessage,
  ]);

  const handleCommit = useCallback(
    async (push: boolean) => {
      if (pending) return;
      setPending(push ? "commitPush" : "commit");
      // Persistent loading toast: the toast store is global, so the progress
      // stays visible (and the outcome lands) even if the panel closes and
      // this component unmounts mid-operation. Success/error reuse the id to
      // swap the same toast in place.
      const toastId = toast.loading(
        push ? "Committing and pushing…" : "Committing…",
      );
      try {
        const result = await commitGitFlow({
          workspaceId,
          message: message.trim() || undefined,
          includeUnstaged,
          providerId,
          push,
        }).unwrap();
        prefillSeqRef.current++;
        setMessage("");
        toast.success(
          push ? "Committed and pushed" : `Committed ${result.summary}`,
          { id: toastId },
        );
        // Refresh the panel's live status in place for both commit and
        // commit+push. getGitFlowStatus isn't WorkspaceDiffs-tagged (to avoid a
        // resync cascade), so it needs an explicit refetch after the mutation —
        // otherwise the dropdown keeps showing the pre-commit changes.
        refreshStatus();
      } catch (err) {
        toast.error(typeof err === "string" ? err : "Commit failed", {
          id: toastId,
        });
      } finally {
        setPending(null);
      }
    },
    [
      workspaceId,
      pending,
      setPending,
      commitGitFlow,
      message,
      includeUnstaged,
      providerId,
      refreshStatus,
    ],
  );

  const handlePush = useCallback(async () => {
    if (pending) return;
    setPending("push");
    const toastId = toast.loading("Pushing…");
    try {
      await pushGitFlow(workspaceId).unwrap();
      toast.success("Pushed", { id: toastId });
      refreshStatus();
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Push failed", {
        id: toastId,
      });
    } finally {
      setPending(null);
    }
  }, [workspaceId, pending, setPending, pushGitFlow, refreshStatus]);

  return (
    <>
      <PanelItem
        icon={<Commit className="size-4" />}
        label="Commit or push"
        expandable
        expanded={isSectionOpen("commit")}
        onClick={() => toggleSection("commit")}
        disabled={!hasChanges && !canPush}
      />
      <PanelCollapse isOpen={isSectionOpen("commit")}>
        <div className={`${PANEL_ROW_X} pt-2`}>
          <div className="relative">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (hasChanges && !busy) handleCommit(false);
                }
              }}
              rows={3}
              placeholder={
                generatingMessage
                  ? "Generating commit message…"
                  : "Commit message (leave blank to generate)…"
              }
              className="w-full resize-none text-xs pb-8"
            />
            <GenerateButton
              onClick={handleGenerateMessage}
              disabled={!hasChanges || busy || generatingMessage}
              generating={generatingMessage}
              tooltip="Generate a commit message from the changes"
            />
          </div>
          <CheckboxOption
            checked={includeUnstaged}
            onChange={() => setIncludeUnstaged((v) => !v)}
            className="mt-1 mb-2"
          >
            Include unstaged changes
          </CheckboxOption>
        </div>
        <PanelItem
          icon={<Commit className="size-4" />}
          label="Commit"
          onClick={() => handleCommit(false)}
          disabled={!hasChanges || busy}
          loading={pending === "commit"}
        />
        {hasRemote && (
          <>
            <PanelItem
              icon={<ArrowUp className="size-4" />}
              label="Commit and push"
              onClick={() => handleCommit(true)}
              disabled={!hasChanges || busy}
              loading={pending === "commitPush"}
            />
            <PanelItem
              icon={<ArrowUp className="size-4" />}
              label="Push"
              onClick={handlePush}
              disabled={!canPush || busy}
              loading={pending === "push"}
            />
          </>
        )}
      </PanelCollapse>
    </>
  );
}
