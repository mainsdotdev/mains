import { ipcMain } from "electron";
import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { fail, ok } from "../../../shared/ipc-kit/service-response";
import { keyboardShortcutsService } from "./keyboardShortcuts.service";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Local-only: a remote renderer must not rewrite shortcuts on the host Mac. */
export function registerKeyboardShortcutsIpc(): void {
  ipcMain.handle(CHANNELS.keyboardShortcuts.get, () =>
    ok(keyboardShortcutsService.getStatus()),
  );
  ipcMain.handle(CHANNELS.keyboardShortcuts.update, async (_event, input) => {
    try {
      return ok(await keyboardShortcutsService.update(input));
    } catch (error) {
      return fail(messageOf(error));
    }
  });
  ipcMain.handle(CHANNELS.keyboardShortcuts.resetAll, async () => {
    try {
      return ok(await keyboardShortcutsService.resetAll());
    } catch (error) {
      return fail(messageOf(error));
    }
  });
}

export function unregisterKeyboardShortcutsIpc(): void {
  ipcMain.removeHandler(CHANNELS.keyboardShortcuts.get);
  ipcMain.removeHandler(CHANNELS.keyboardShortcuts.update);
  ipcMain.removeHandler(CHANNELS.keyboardShortcuts.resetAll);
}
