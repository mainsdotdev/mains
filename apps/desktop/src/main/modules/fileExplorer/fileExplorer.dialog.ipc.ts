import path from "node:path";
import { BrowserWindow, dialog } from "electron";
import { CHANNELS } from "@mains/contracts/channels";
import { fail, ok } from "@mains/contracts/service-response";
import { ipcMain } from "@mains/backend/ipc-kit/ipc-main";
import { fileExplorerService } from "@mains/backend/modules/fileExplorer";

/** Desktop-only Save As dialog. It is intentionally absent from the server. */
export function registerFileExplorerDialogIpc(): void {
  ipcMain.handle(
    CHANNELS.fileExplorer.saveFileAs,
    async (_, sourcePath: string, suggestedName?: string) => {
      try {
        const window = BrowserWindow.getFocusedWindow();
        const options = {
          title: "Save File",
          buttonLabel: "Save",
          defaultPath: suggestedName || path.basename(sourcePath),
        };
        const result = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options);

        if (result.canceled || !result.filePath) return ok(null);
        await fileExplorerService.saveFileAs(sourcePath, result.filePath);
        return ok(result.filePath);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save file";
        console.error("[FileExplorer] saveFileAs failed:", error);
        return fail(message);
      }
    },
  );
}

export function unregisterFileExplorerDialogIpc(): void {
  ipcMain.removeHandler(CHANNELS.fileExplorer.saveFileAs);
}
