import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useCapabilities } from "@/lib/platform";
import { useCommandNavigation } from "@/features/command-menu/use-command-navigation";
import { useJumpToRun } from "@/features/workspace/hooks/use-jump-to-run";
import type { WindowRequest } from "../../shared/window-request";
import type { ServiceResponse } from "../../shared/ipc-kit/service-response";
import { createWindowRequestDelivery } from "../../shared/window-lifecycle";

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
  const carryOut = useRef<(request: WindowRequest) => void | Promise<unknown>>(() => {});
  useLayoutEffect(() => {
    carryOut.current = (request) => {
      switch (request.kind) {
        case "openRun": {
          const { runId, ...run } = request.run;
          return jumpToRun({ id: runId, ...run });
        }
        case "openWorkspace":
          return openWorkspace(request.workspaceId);
        case "newChat":
          newChat();
          return;
        case "navigate":
          navigate(request.path);
          return;
      }
    };
  }, [jumpToRun, newChat, openWorkspace, navigate]);

  useEffect(() => {
    if (!caps.windowChrome || !isLoaded) return;
    const delivery = createWindowRequestDelivery<WindowRequest>();
    const app = window.api.app;

    const collect = () => {
      void delivery.collect(async () => {
        const response: ServiceResponse<WindowRequest | null> = await app.consumeWindowRequest();
        return response.success ? response.data : null;
      }, (request) => carryOut.current(request)).catch((error) => {
        console.error("Unable to deliver window request:", error);
      });
    };

    const unsubscribe = app.onWindowRequest(collect);
    collect();
    return () => {
      delivery.close();
      unsubscribe();
    };
  }, [caps.windowChrome, isLoaded]);
}
