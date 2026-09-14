import path from "path";
import { BrowserWindow, dialog } from "electron";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { ok, fail } from "../../../shared/ipc-kit/service-response";
import { fileExplorerService } from "./fileExplorer.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import type {
  ReadDirectoryOptions,
  ReadFileTextOptions,
  WriteFileTextOptions,
  ListDirOptions,
  SearchFilesOptions,
} from "./fileExplorer.dto";

// ─────────────────────────────────────────────────────────────
// IPC Channel Names
// ─────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────
export function registerFileExplorerIpc(): void {
  ipcMain.handle(
    CHANNELS.fileExplorer.readDirectory,
    handle((options: ReadDirectoryOptions) => fileExplorerService.readDirectory(options)),
  );

  ipcMain.handle(
    CHANNELS.fileExplorer.readDirectoryShallow,
    handle((dirPath: string, options?: { includeHidden?: boolean; excludePatterns?: string[] }) => fileExplorerService.readDirectoryShallow(dirPath, options)),
  );

  ipcMain.handle(
    CHANNELS.fileExplorer.getPathInfo,
    handle((targetPath: string) => fileExplorerService.getPathInfo(targetPath)),
  );

  ipcMain.handle(
    CHANNELS.fileExplorer.readFile,
    handle((filePath: string) => fileExplorerService.readFile(filePath)),
  );

  ipcMain.handle(
    CHANNELS.fileExplorer.readFileText,
    handle((options: ReadFileTextOptions) => fileExplorerService.readFileText(options)),
  );

  ipcMain.handle(
    CHANNELS.fileExplorer.listDir,
    handle((options: ListDirOptions) => fileExplorerService.listDir(options)),
  );

  ipcMain.handle(
    CHANNELS.fileExplorer.searchFiles,
    handle((options: SearchFilesOptions) => fileExplorerService.searchFiles(options)),
  );

  ipcMain.handle(
    CHANNELS.fileExplorer.writeFileText,
    handle((options: WriteFileTextOptions) => fileExplorerService.writeFileText(options)),
  );

  // Native dialog — needs the focused window, so it stays hand-written like
  // `workspace:selectDirectory`. Returns the saved path, or null when the user
  // cancels: cancelling is a choice, not a failure.
  ipcMain.handle(
    CHANNELS.fileExplorer.saveFileAs,
    async (_, sourcePath: string, suggestedName?: string) => {
      try {
        const window = BrowserWindow.getFocusedWindow();
        const defaultPath = suggestedName || path.basename(sourcePath);
        const options = {
          title: "Save File",
          buttonLabel: "Save",
          defaultPath,
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

export function unregisterFileExplorerIpc(): void {
  [
    CHANNELS.fileExplorer.readDirectory,
    CHANNELS.fileExplorer.readDirectoryShallow,
    CHANNELS.fileExplorer.getPathInfo,
    CHANNELS.fileExplorer.readFile,
    CHANNELS.fileExplorer.readFileText,
    CHANNELS.fileExplorer.listDir,
    CHANNELS.fileExplorer.searchFiles,
    CHANNELS.fileExplorer.writeFileText,
    CHANNELS.fileExplorer.saveFileAs,
  ].forEach((channel) => ipcMain.removeHandler(channel));
}
