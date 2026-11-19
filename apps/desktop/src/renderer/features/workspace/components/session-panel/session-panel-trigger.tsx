import { Menu } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { useResyncWorkspaceDiffMutation } from "@/lib/redux/api";

/**
 * Opens the panel for the current session or for running servers anywhere in Mains.
 */
export function SessionPanelTrigger({
  showSessionDetails,
  hasRunningServers,
  diffWorkspaceId,
}: {
  showSessionDetails: boolean;
  hasRunningServers: boolean;
  diffWorkspaceId: string | null;
}) {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.appSettings.sessionPanelOpen);

  // Recomputes + persists the canonical workspace diff and invalidates the
  // WorkspaceDiffs cache, so the sidebar workspace item (which reads that
  // stored diff) reflects the same numbers the panel shows live.
  const [resyncWorkspaceDiff] = useResyncWorkspaceDiffMutation();

  const label = `${isOpen ? "Close" : "Open"} ${showSessionDetails ? "session details" : "running servers"}`;

  return (
    <Button
      variant="icon"
      onClick={() => {
        dispatch(setSessionPanelOpen(!isOpen));
        // Refresh the stored workspace diff on open so the sidebar item matches
        // the panel's live numbers (the agent run / manual refresh aren't the
        // only moments the working tree changes).
        if (!isOpen && diffWorkspaceId) {
          resyncWorkspaceDiff(diffWorkspaceId);
        }
      }}
      aria-expanded={isOpen}
      aria-label={label}
      tooltip={label}
      tooltipPosition="left"
      className={isOpen ? "text-primary-700 dark:text-primary-300" : undefined}
    >
      <Menu className={!isOpen && hasRunningServers ? "size-4 text-success" : "size-4"} fill={isOpen ? "currentColor" : "none"} />
    </Button>
  );
}
