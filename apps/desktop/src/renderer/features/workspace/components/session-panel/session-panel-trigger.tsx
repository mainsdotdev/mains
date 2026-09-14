import { Menu } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setSessionPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { useResyncWorkspaceDiffMutation } from "@/lib/redux/api";

/**
 * Opens the session panel. Lives in the top-right toggle cluster while the
 * panel itself is mounted by the app shell — the panel takes a column of the
 * layout, so its open state is app-level (redux), not local to this button.
 */
export function SessionPanelTrigger() {
  const dispatch = useAppDispatch();
  const activeWorkspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );
  const isOpen = useAppSelector((state) => state.appSettings.sessionPanelOpen);

  // Recomputes + persists the canonical workspace diff and invalidates the
  // WorkspaceDiffs cache, so the sidebar workspace item (which reads that
  // stored diff) reflects the same numbers the panel shows live.
  const [resyncWorkspaceDiff] = useResyncWorkspaceDiffMutation();

  if (!activeWorkspaceId) return null;

  return (
    <Button
      onClick={() => {
        dispatch(setSessionPanelOpen(!isOpen));
        // Refresh the stored workspace diff on open so the sidebar item matches
        // the panel's live numbers (the agent run / manual refresh aren't the
        // only moments the working tree changes).
        if (!isOpen) resyncWorkspaceDiff(activeWorkspaceId);
      }}
      aria-expanded={isOpen}
      aria-label={isOpen ? "Close session panel" : "Open session panel"}
      tooltip={isOpen ? "Close session panel" : "Open session panel"}
      tooltipPosition="left"
      className={`flex items-center glass-outline rounded-full gap-1 px-1.75 py-1.75 cursor-pointer hover:bg-primary-100/80 dark:hover:bg-primary/10 transition-all duration-300 ease-out ${
        isOpen
          ? "text-primary-900 dark:text-primary-100"
          : "text-primary-700 dark:text-primary-300"
      }`}
    >
      <Menu className="size-3.75" />
    </Button>
  );
}
