import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useCapabilities } from "@/lib/platform";
import { useCommandNavigation } from "@/features/command-menu/use-command-navigation";
import { useJumpToRun } from "@/features/workspace/hooks/use-jump-to-run";
import type { WindowRequest } from "../../shared/window-request";
import type { ServiceResponse } from "../../shared/ipc-kit/service-response";

/**
 * Carries out what a desktop notification, the menu bar or the Dock menu asked
 * the window to do. Main parks the request and pings; the window collects it —
 * on the ping, or on mount when the click had to re-create a closed window.
 * Collection waits for the spaces to load, since opening a run has to pick its
 * space.
 */
export function useWindowRequests(): void {
  const caps = useCapabilities();
  const { isLoaded } = useActiveSpace();
  const navigate = useNavigate();
  const jumpToRun = useJumpToRun();
  const { newChat, openWorkspace } = useCommandNavigation();

  useEffect(() => {
    // Requests come from this Mac's notifications, menu bar icon and Dock.
    if (!caps.windowChrome || !isLoaded) return;

    const carryOut = (request: WindowRequest) => {
      switch (request.kind) {
        case "openRun": {
          const { runId, ...run } = request.run;
          void jumpToRun({ id: runId, ...run });
          return;
        }
        case "openWorkspace":
          void openWorkspace(request.workspaceId);
          return;
        case "newChat":
          newChat();
          return;
        case "navigate":
          navigate(request.path);
          return;
      }
    };

    const collect = () => {
      void window.api.app.consumeWindowRequest().then(
        (response: ServiceResponse<WindowRequest | null>) => {
          if (response.success && response.data) carryOut(response.data);
        },
        () => {
          // The renderer can mount while the app is shutting down.
        },
      );
    };

    const unsubscribe = window.api.app.onWindowRequest(collect);
    collect();
    return () => {
      unsubscribe();
    };
  }, [caps.windowChrome, isLoaded, jumpToRun, newChat, openWorkspace, navigate]);
}
