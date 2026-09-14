import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { pulseService } from "./pulse.service";
import type { CreatePulseInput, UpdatePulseInput } from "./pulse.dto";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

export function registerPulseIpc() {
  ipcMain.handle(CHANNELS.pulse.getAll, handle(() => pulseService.getAll()));

  ipcMain.handle(CHANNELS.pulse.getById, handle((id: string) => pulseService.getById(id)));

  ipcMain.handle(
    CHANNELS.pulse.create,
    handle((accountId: string, input: CreatePulseInput) =>
      pulseService.create(accountId, input),
    ),
  );

  ipcMain.handle(
    CHANNELS.pulse.update,
    handle((id: string, input: UpdatePulseInput) =>
      pulseService.update(id, input),
    ),
  );

  ipcMain.handle(CHANNELS.pulse.delete, handle((id: string) => pulseService.delete(id)));

  ipcMain.handle(
    CHANNELS.pulse.toggle,
    handle((id: string, isActive: boolean) => pulseService.toggle(id, isActive)),
  );

  ipcMain.handle(CHANNELS.pulse.runNow, handle((id: string) => pulseService.runNow(id)));
}

export function unregisterPulseIpc() {
  ipcMain.removeHandler(CHANNELS.pulse.getAll);
  ipcMain.removeHandler(CHANNELS.pulse.getById);
  ipcMain.removeHandler(CHANNELS.pulse.create);
  ipcMain.removeHandler(CHANNELS.pulse.update);
  ipcMain.removeHandler(CHANNELS.pulse.delete);
  ipcMain.removeHandler(CHANNELS.pulse.toggle);
  ipcMain.removeHandler(CHANNELS.pulse.runNow);
}
