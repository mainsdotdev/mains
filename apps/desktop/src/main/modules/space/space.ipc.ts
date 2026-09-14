import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { spaceService } from "./space.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// Space IPC Handlers
// ─────────────────────────────────────────────────────────────
export function registerSpaceIpc() {
  ipcMain.handle(
    CHANNELS.space.getAll,
    handle(() => spaceService.getAll()),
  );

  ipcMain.handle(
    CHANNELS.space.getById,
    handle((spaceId: string) => spaceService.getById(spaceId)),
  );

  ipcMain.handle(
    CHANNELS.space.create,
    handle((payload: unknown) => spaceService.create(payload)),
  );

  ipcMain.handle(
    CHANNELS.space.update,
    handle((spaceId: string, payload: unknown) =>
      spaceService.update(spaceId, payload),
    ),
  );

  ipcMain.handle(
    CHANNELS.space.delete,
    handle((spaceId: string) => spaceService.delete(spaceId)),
  );

  ipcMain.handle(
    CHANNELS.space.archive,
    handle((spaceId: string) => spaceService.archive(spaceId)),
  );

  ipcMain.handle(
    CHANNELS.space.unarchive,
    handle((spaceId: string) => spaceService.unarchive(spaceId)),
  );
}

export function unregisterSpaceIpc() {
  ipcMain.removeHandler(CHANNELS.space.getAll);
  ipcMain.removeHandler(CHANNELS.space.getById);
  ipcMain.removeHandler(CHANNELS.space.create);
  ipcMain.removeHandler(CHANNELS.space.update);
  ipcMain.removeHandler(CHANNELS.space.delete);
  ipcMain.removeHandler(CHANNELS.space.archive);
  ipcMain.removeHandler(CHANNELS.space.unarchive);
}
