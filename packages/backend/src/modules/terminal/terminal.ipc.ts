import { ok, fail } from "@mains/contracts/service-response";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { emit } from "../../ipc-kit";
import { terminalService } from "./terminal.service";
import { CHANNELS } from "@mains/contracts/channels";
import { handle } from "../../ipc-kit/handle";
import type { TerminalCreateOptions } from "@mains/contracts/terminal";
let stopServerWatch: (() => void) | undefined;

function terminalCallbacks(ctx: { clientId?: string }) {
  const target = ctx?.clientId ? { clientId: ctx.clientId } : undefined;
  return {
    data: (id: string, data: string, sequence: number) => emit(CHANNELS.terminal.data, { id, data, sequence }, target),
    exit: (id: string, exitCode: number) => {
      emit(CHANNELS.terminal.exit, { id, exitCode }, target);
      emit(CHANNELS.terminal.changed, {});
    },
  };
}

export function registerTerminalIpc(): void {
  stopServerWatch?.();
  stopServerWatch = terminalService.watchServers(() => emit(CHANNELS.terminal.changed, {}));
  ipcMain.handle(
    CHANNELS.terminal.create,
    async (ctx: { clientId?: string }, payload: TerminalCreateOptions) => {
      try {
        // On the WS path `ctx.clientId` is the connection that created the
        // terminal, so its output is scoped to that client. On the local path it
        // is undefined and the event broadcasts (the renderer filters
        // `terminal:data` by terminal id, so other windows ignore it).
        const callbacks = terminalCallbacks(ctx);
        const snapshot = terminalService.create(payload.id, payload.cwd, callbacks.data, payload, callbacks.exit);
        emit(CHANNELS.terminal.changed, {});
        return ok(snapshot);
      } catch (err) {
        console.error("[Terminal] Failed to create terminal:", err);
        return fail(err instanceof Error ? err.message : "Failed to create terminal");
      }
    },
  );

  ipcMain.handle(CHANNELS.terminal.attach, async (ctx: { clientId?: string }, id: string) => {
    try {
      const callbacks = terminalCallbacks(ctx);
      return ok(terminalService.attach(id, callbacks.data, callbacks.exit));
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Could not attach to terminal.");
    }
  });
  ipcMain.handle(CHANNELS.terminal.list, handle(() => terminalService.list()));

  ipcMain.handle(CHANNELS.terminal.write, handle((id: string, data: string) => {
    terminalService.write(id, data);
  }));

  ipcMain.handle(
    CHANNELS.terminal.resize,
    handle((id: string, cols: number, rows: number) => {
      terminalService.resize(id, cols, rows);
    }),
  );

  ipcMain.handle(CHANNELS.terminal.destroy, handle((id: string) => {
    terminalService.destroy(id);
    emit(CHANNELS.terminal.changed, {});
  }));
  ipcMain.handle(CHANNELS.terminal.destroyIdle, handle(async (workspaceId: string) => {
    const stopped = await terminalService.destroyIdle(workspaceId);
    if (stopped.length > 0) emit(CHANNELS.terminal.changed, {});
    return stopped;
  }));
}

export function unregisterTerminalIpc(): void {
  stopServerWatch?.();
  stopServerWatch = undefined;
  ipcMain.removeHandler(CHANNELS.terminal.attach);
  ipcMain.removeHandler(CHANNELS.terminal.list);
  ipcMain.removeHandler(CHANNELS.terminal.create);
  ipcMain.removeHandler(CHANNELS.terminal.write);
  ipcMain.removeHandler(CHANNELS.terminal.resize);
  ipcMain.removeHandler(CHANNELS.terminal.destroy);
  ipcMain.removeHandler(CHANNELS.terminal.destroyIdle);
}

export function destroyAllTerminals(): void {
  terminalService.destroyAll();
}
