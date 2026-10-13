import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setBottomTerminalOpen } from "@/lib/redux/slices/appSettingsSlice";
import { forgetTerminal, terminalWorkspaceKey } from "@/lib/redux/slices/terminalSlice";
import { useStopIdleTerminalsMutation } from "@/lib/redux/api";
import { toast } from "@/components/ui";

interface BottomTerminalState {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

/**
 * Open/closed state of the bottom terminal drawer, held in `appSettings` so it
 * persists with every other UI preference. Previously a context + its own
 * localStorage key; redux already gives both the sharing and the persistence,
 * so there is no provider to mount.
 */
export function useBottomTerminal(): BottomTerminalState {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.appSettings.bottomTerminalOpen);
  const workspaceId = useAppSelector((state) => state.workspace.activeWorkspaceId);
  const backendId = useAppSelector((state) => state.backends.activeBackendId ?? "local");
  const [stopIdle] = useStopIdleTerminalsMutation();

  const close = useCallback(() => {
    // Start on the current backend before hiding. Cleanup never comes from
    // view unmounts, so switching workspaces does not stop their terminals.
    const cleanup = workspaceId ? stopIdle(workspaceId).unwrap() : null;
    dispatch(setBottomTerminalOpen(false));
    if (cleanup && workspaceId) void cleanup.then((ids) => {
      const key = terminalWorkspaceKey(backendId, workspaceId);
      for (const id of ids) dispatch(forgetTerminal({ key, id }));
    }).catch(() => toast.error("Could not close idle terminals."));
  }, [backendId, dispatch, stopIdle, workspaceId]);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else dispatch(setBottomTerminalOpen(true));
  }, [close, dispatch, isOpen]);

  const open = useCallback(() => {
    dispatch(setBottomTerminalOpen(true));
  }, [dispatch]);

  return { isOpen, toggle, open, close };
}
