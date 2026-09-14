import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setBottomTerminalOpen } from "@/lib/redux/slices/appSettingsSlice";

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

  const toggle = useCallback(() => {
    dispatch(setBottomTerminalOpen(!isOpen));
  }, [dispatch, isOpen]);

  const open = useCallback(() => {
    dispatch(setBottomTerminalOpen(true));
  }, [dispatch]);

  const close = useCallback(() => {
    dispatch(setBottomTerminalOpen(false));
  }, [dispatch]);

  return { isOpen, toggle, open, close };
}
