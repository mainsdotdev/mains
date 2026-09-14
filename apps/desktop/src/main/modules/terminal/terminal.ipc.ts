import { ok, fail } from "../../../shared/ipc-kit/service-response";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { emit } from "../../ipc-kit";
import { terminalService } from "./terminal.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

export function registerTerminalIpc(): void {
  ipcMain.handle(
    CHANNELS.terminal.create,
    async (ctx: { clientId?: string }, payload: { id: string; cwd?: string }) => {
      try {
        // On the WS path `ctx.clientId` is the connection that created the
        // terminal, so its output is scoped to that client. On the local path it
        // is undefined and the event broadcasts (the renderer filters
        // `terminal:data` by terminal id, so other windows ignore it).
        const clientId = ctx?.clientId;
        terminalService.create(payload.id, payload.cwd, (id, data) => {
          emit(
            CHANNELS.terminal.data,
            { id, data },
            clientId ? { clientId } : undefined,
          );
        });

        return ok(undefined);
      } catch (err) {
        console.error("[Terminal] Failed to create terminal:", err);
        return fail(err instanceof Error ? err.message : "Failed to create terminal");
      }
    },
  );

  ipcMain.handle(CHANNELS.terminal.write, async (_, id: string, data: string) => {
    terminalService.write(id, data);
    return ok(undefined);
  });

  ipcMain.handle(
    CHANNELS.terminal.resize,
    async (_, id: string, cols: number, rows: number) => {
      terminalService.resize(id, cols, rows);
      return ok(undefined);
    },
  );

  ipcMain.handle(CHANNELS.terminal.destroy, async (_, id: string) => {
    terminalService.destroy(id);
    return ok(undefined);
  });
}

export function unregisterTerminalIpc(): void {
  ipcMain.removeHandler(CHANNELS.terminal.create);
  ipcMain.removeHandler(CHANNELS.terminal.write);
  ipcMain.removeHandler(CHANNELS.terminal.resize);
  ipcMain.removeHandler(CHANNELS.terminal.destroy);
}

export function destroyAllTerminals(): void {
  terminalService.destroyAll();
}
