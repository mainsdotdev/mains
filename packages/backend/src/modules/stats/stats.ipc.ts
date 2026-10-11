import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { statsService } from "./stats.service";
import { CHANNELS } from "@mains/contracts/channels";
import type { DashboardQuery, ProviderFilter } from "./stats.dto";

export function registerStatsIpc(): void {
  ipcMain.handle(CHANNELS.stats.getConsumption, handle((query?: DashboardQuery) => statsService.getConsumption(query)));
  ipcMain.handle(
    CHANNELS.stats.getDashboard,
    handle((query?: DashboardQuery | ProviderFilter) =>
      statsService.getDashboard(query),
    ),
  );
}

export function unregisterStatsIpc(): void {
  ipcMain.removeHandler(CHANNELS.stats.getConsumption);
  ipcMain.removeHandler(CHANNELS.stats.getDashboard);
}
