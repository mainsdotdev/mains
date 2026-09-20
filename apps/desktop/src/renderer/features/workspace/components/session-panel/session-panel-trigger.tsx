import { Menu } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { useResyncWorkspaceDiffMutation } from "@/lib/redux/api";
import { selectSessionRunId } from "./select-session-run";

/**
 * Opens the session panel. Code may open it for the workspace environment even
 * before a run exists; Work opens it for the visible run's sources.
 */
export function SessionPanelTrigger({
  showGitActions,
  showSources,
}: {
  showGitActions: boolean;
  showSources: boolean;
}) {
  const dispatch = useAppDispatch();
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );
  const sessionRunId = useAppSelector((state) =>
    selectSessionRunId(state.workspace),
  );
  const isOpen = useAppSelector((state) => state.appSettings.sessionPanelOpen);

  // Recomputes + persists the canonical workspace diff and invalidates the
  // WorkspaceDiffs cache, so the sidebar workspace item (which reads that
  // stored diff) reflects the same numbers the panel shows live.
  const [resyncWorkspaceDiff] = useResyncWorkspaceDiffMutation();

  const canOpen =
    (showGitActions && !!activeWorkspaceId) || (showSources && !!sessionRunId);
  if (!canOpen) return null;

  return (
    <Button
      onClick={() => {
        dispatch(setSessionPanelOpen(!isOpen));
        // Refresh the stored workspace diff on open so the sidebar item matches
        // the panel's live numbers (the agent run / manual refresh aren't the
        // only moments the working tree changes).
        if (!isOpen && showGitActions && activeWorkspaceId) {
          resyncWorkspaceDiff(activeWorkspaceId);
        }
      }}
      aria-expanded={isOpen}
      aria-label={isOpen ? "Close session details" : "Open session details"}
      tooltip={isOpen ? "Close session details" : "Open session details"}
      tooltipPosition="left"
      className={`flex items-center rounded-full gap-1 p-1.5 cursor-pointer hover:bg-primary-100/80 dark:hover:bg-primary/10 transition-all duration-300 ease-out ${
        isOpen
          ? "text-primary-900 dark:text-primary-100"
          : "text-primary-700 dark:text-primary-300"
      }`}
    >
      <Menu className="size-3.75" />
    </Button>
  );
}
