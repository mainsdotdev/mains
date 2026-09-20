import { useEffect } from "react";
import { CHANNELS } from "../../shared/ipc-kit/channels";
import { appSettingsApi } from "@/lib/redux/api";
import { useAppDispatch } from "@/lib/redux/hooks";
import { subscribeEvent } from "@/lib/transport";

/**
 * Settings can change outside the window (the menu bar's toggles). Main says
 * so on `appSettings:changed`; refetch so Settings never shows a stale switch.
 */
export function useAppSettingsEvents(): void {
  const dispatch = useAppDispatch();

  useEffect(
    () =>
      subscribeEvent(CHANNELS.appSettings.changed, () => {
        dispatch(appSettingsApi.util.invalidateTags(["AppSettings"]));
      }),
    [dispatch],
  );
}
