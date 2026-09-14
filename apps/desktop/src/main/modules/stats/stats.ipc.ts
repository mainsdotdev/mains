import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { statsService } from "./stats.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import type { ProviderFilter } from "./stats.dto";

export function registerStatsIpc(): void {
  ipcMain.handle(
    CHANNELS.stats.getDashboard,
    handle((filter?: string) =>
      statsService.getDashboard(filter as ProviderFilter | undefined),
    ),
  );
}

export function unregisterStatsIpc(): void {
  ipcMain.removeHandler(CHANNELS.stats.getDashboard);
}
