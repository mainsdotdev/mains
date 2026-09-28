import type { ReactNode } from "react";
import { useAppSelector } from "@/lib/redux/hooks";
import { ChangesSection } from "./changes-section";
import { BranchSection } from "./branch-section";
import { CommitSection } from "./commit-section";
import { PullSection } from "./pull-section";
import { PrSection } from "./pr-section";
import { PublishSection } from "./publish-section";
import { useGitActionsPanel } from "./use-git-actions-panel";

interface GitActionsSectionProps {
  providerId?: string;
  /** Closes the panel this section lives in (a created PR dismisses it). */
  onClose: () => void;
  onPrEditorOpenChange: (open: boolean, transitioning: boolean) => void;
  onPrEditorTransitionEnd: () => void;
  /**
   * Rendered under the git actions — the session's subagent list. Kept as a
   * slot so this file stays about git and the panel decides the ordering. It
   * brings its own separator, since it renders nothing at all when the session
   * has no subagents.
   */
  footer?: ReactNode;
}

/**
 * Working-tree state and the git actions for the active workspace, as a menu:
 * every line is a `PanelItem`, and the action rows open their form in place
 * instead of swapping the panel's contents.
 *
 * Each row below is its own component owning its own form state; what they
 * share — the status they read, which row is open, and the single in-flight
 * action — comes from `useGitActionsPanel`. Whether a row is *usable* is that
 * hook's business too, since a row that turns unusable has to close itself.
 *
 * Mounted while the session panel is open, including while its PR editor is
 * expanded into a modal. A normal panel close unmounts it and resets the forms.
 */
export function GitActionsSection({
  providerId,
  onClose,
  onPrEditorOpenChange,
  onPrEditorTransitionEnd,
  footer,
}: GitActionsSectionProps) {
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );

  if (!activeWorkspaceId) return null;

  return (
    <GitActions
      workspaceId={activeWorkspaceId}
      providerId={providerId}
      onClose={onClose}
      onPrEditorOpenChange={onPrEditorOpenChange}
      onPrEditorTransitionEnd={onPrEditorTransitionEnd}
      footer={footer}
    />
  );
}

/** Split out so the panel hook runs against a workspace that definitely exists. */
function GitActions({
  workspaceId,
  providerId,
  onClose,
  onPrEditorOpenChange,
  onPrEditorTransitionEnd,
  footer,
}: GitActionsSectionProps & { workspaceId: string }) {
  const panel = useGitActionsPanel(workspaceId);

  return (
    <div>
      <ChangesSection panel={panel} />
      <BranchSection panel={panel} />
      <CommitSection panel={panel} providerId={providerId} />
      {/* Nothing to pull from without a remote — the row goes with push/PR. */}
      {panel.hasRemote && <PullSection panel={panel} />}
      {/* No remote yet — push/PR are impossible. Publish takes the slot. */}
      {panel.hasRemote ? (
        <PrSection
          panel={panel}
          providerId={providerId}
          onClose={onClose}
          onEditorOpenChange={onPrEditorOpenChange}
          onEditorTransitionEnd={onPrEditorTransitionEnd}
        />
      ) : (
        <PublishSection panel={panel} />
      )}
      {footer}
    </div>
  );
}
