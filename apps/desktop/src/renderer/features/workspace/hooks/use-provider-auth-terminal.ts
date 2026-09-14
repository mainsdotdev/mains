import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  closeProviderAuthTerminal,
  markProviderAuthCommandSent,
  openProviderAuthTerminal,
} from "@/lib/redux/slices/workspaceSlice";

/**
 * Ephemeral recovery terminal for interactive provider login commands.
 * It is separate from the Code-mode terminal preference so Work and Chat can
 * expose authentication without exposing a permanent terminal affordance.
 */
export function useProviderAuthTerminal() {
  const dispatch = useAppDispatch();
  const session = useAppSelector(
    (state) => state.workspace.providerAuthTerminal,
  );

  const open = useCallback(
    (providerId: string, command: string) => {
      dispatch(openProviderAuthTerminal({ providerId, command }));
    },
    [dispatch],
  );

  const markCommandSent = useCallback(() => {
    dispatch(markProviderAuthCommandSent());
  }, [dispatch]);

  const close = useCallback(() => {
    dispatch(closeProviderAuthTerminal());
  }, [dispatch]);

  return { session, open, markCommandSent, close };
}
