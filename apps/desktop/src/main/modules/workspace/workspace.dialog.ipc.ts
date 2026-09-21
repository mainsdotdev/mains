import { BrowserWindow, dialog } from "electron";
import type { OpenDialogOptions } from "electron";
import { ok } from "../../../shared/ipc-kit/service-response";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { ipcMain } from "../../ipc-kit/ipc-main";

/** Desktop-only directory picker. It is intentionally absent from the server. */
export function registerWorkspaceDialogIpc(): void {
  ipcMain.handle(CHANNELS.workspace.selectDirectory, async () => {
    const window = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      properties: ["openDirectory"],
      title: "Select Project Folder",
      buttonLabel: "Select",
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) return ok(null);
    return ok(result.filePaths[0]);
  });
}

export function unregisterWorkspaceDialogIpc(): void {
  ipcMain.removeHandler(CHANNELS.workspace.selectDirectory);
}
