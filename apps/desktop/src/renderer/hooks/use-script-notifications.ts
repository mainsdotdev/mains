import { useEffect } from "react";
import { appEvents } from "@/lib/transport";
import { useAppDispatch } from "@/lib/redux/hooks";
import { workspaceApi } from "@/lib/redux/api/workspaceApi";
import { toast } from "@/components/ui";

/**
 * Listens for workspace events from the main process and invalidates the
 * relevant RTK Query caches so the UI refreshes automatically.
 */
export function useScriptNotifications(): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const unsubscribeScript = appEvents.workspace.onScriptComplete((data) => {
      dispatch(workspaceApi.util.invalidateTags(["Workspaces"]));

      if (!data.success) {
        toast.error(`${data.script === "setup" ? "Setup" : "Archive"} script failed${data.error ? `: ${data.error}` : ""}`);
      }
    });

    const unsubscribeFindings = appEvents.workspace.onFindingsChanged(() => {
      dispatch(
        workspaceApi.util.invalidateTags([
          "ReviewFindings",
          "WorkspaceActivity",
        ]),
      );
    });

    return () => {
      unsubscribeScript();
      unsubscribeFindings();
    };
  }, [dispatch]);
}
