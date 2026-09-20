import { ipcMain } from "electron";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { handle } from "../../ipc-kit/handle";
import { appshotsService } from "./appshots.service";
import {
  requireAppshotsConfiguration,
  requireCaptureId,
  requireCaptureName,
  requireSystemSettingsPane,
} from "./appshots.validation";

/** Appshots controls the local Mac and is intentionally not registered on WS. */
export function registerAppshotsIpc(): void {
  ipcMain.handle(
    CHANNELS.appshots.getStatus,
    handle(() => appshotsService.getStatus()),
  );
  ipcMain.handle(
    CHANNELS.appshots.configure,
    handle((input: unknown) =>
      appshotsService.configure(requireAppshotsConfiguration(input)),
    ),
  );
  ipcMain.handle(
    CHANNELS.appshots.captureNow,
    handle(() => appshotsService.captureAndDeliver()),
  );
  ipcMain.handle(
    CHANNELS.appshots.consumePending,
    handle(() => appshotsService.consumePending()),
  );
  ipcMain.handle(
    CHANNELS.appshots.acknowledge,
    handle((captureId: unknown) =>
      appshotsService.acknowledge(requireCaptureId(captureId)),
    ),
  );
  ipcMain.handle(
    CHANNELS.appshots.deleteCapture,
    handle((captureName: unknown) =>
      appshotsService.deleteCapture(requireCaptureName(captureName)),
    ),
  );
  ipcMain.handle(
    CHANNELS.appshots.requestAccessibility,
    handle(() => appshotsService.requestAccessibility()),
  );
  ipcMain.handle(
    CHANNELS.appshots.openSystemSettings,
    handle((pane: unknown) =>
      appshotsService.openSystemSettings(requireSystemSettingsPane(pane)),
    ),
  );
}

export function unregisterAppshotsIpc(): void {
  [
    CHANNELS.appshots.getStatus,
    CHANNELS.appshots.configure,
    CHANNELS.appshots.captureNow,
    CHANNELS.appshots.consumePending,
    CHANNELS.appshots.acknowledge,
    CHANNELS.appshots.deleteCapture,
    CHANNELS.appshots.requestAccessibility,
    CHANNELS.appshots.openSystemSettings,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
