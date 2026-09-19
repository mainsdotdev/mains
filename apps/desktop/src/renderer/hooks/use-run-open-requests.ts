import { useEffect } from "react";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useCapabilities } from "@/lib/platform";
import { useJumpToRun } from "@/features/workspace/hooks/use-jump-to-run";
import type { RunOpenRequest } from "../../shared/run-open-request";
import type { ServiceResponse } from "../../shared/ipc-kit/service-response";

/**
 * Opens the run a desktop notification was clicked for. Main parks the request
 * and pings; the window collects it — on the ping, or on mount when the click
 * had to re-create a closed window. Collection waits for the spaces to load,
 * since the jump has to pick the run's space.
 */
export function useRunOpenRequests(): void {
  const caps = useCapabilities();
  const { isLoaded } = useActiveSpace();
  const jumpToRun = useJumpToRun();

  useEffect(() => {
    if (!caps.nativeNotifications || !isLoaded) return;

    const collect = () => {
      void window.api.runs.consumeOpenRequest().then(
        (response: ServiceResponse<RunOpenRequest | null>) => {
          if (!response.success || !response.data) return;
          const { runId, ...run } = response.data;
          void jumpToRun({ id: runId, ...run });
        },
        () => {
          // The renderer can mount while the app is shutting down.
        },
      );
    };

    const unsubscribe = window.api.runs.onOpenRequested(collect);
    collect();
    return () => {
      unsubscribe();
    };
  }, [caps.nativeNotifications, isLoaded, jumpToRun]);
}
