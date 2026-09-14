// ─────────────────────────────────────────────────────────────
// Guards IPC Handlers
// ─────────────────────────────────────────────────────────────

import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import type { PackageIdentifier } from "./adapters/adapter.types";
import { guardsService } from "./guards.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

export function registerGuardsIpc(): void {
  ipcMain.handle(
    CHANNELS.guards.getActiveGuard,
    handle(() => guardsService.getActiveGuard()),
  );

  ipcMain.handle(
    CHANNELS.guards.checkPackage,
    handle((pkg: PackageIdentifier) => guardsService.checkPackage(pkg)),
  );

  ipcMain.handle(
    CHANNELS.guards.checkPackages,
    handle((pkgs: PackageIdentifier[]) => guardsService.checkPackages(pkgs)),
  );

  ipcMain.handle(
    CHANNELS.guards.getPackageScore,
    handle((pkg: PackageIdentifier) => guardsService.getPackageScore(pkg)),
  );

  ipcMain.handle(
    CHANNELS.guards.scanWorkspace,
    handle((workspaceId: string, rootPath: string) => guardsService.scanWorkspace(workspaceId, rootPath)),
  );
}

export function unregisterGuardsIpc(): void {
  [
    CHANNELS.guards.getActiveGuard,
    CHANNELS.guards.checkPackage,
    CHANNELS.guards.checkPackages,
    CHANNELS.guards.getPackageScore,
    CHANNELS.guards.scanWorkspace,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
