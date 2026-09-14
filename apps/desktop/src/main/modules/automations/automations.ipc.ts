import { ipcMain } from "../../ipc-kit/ipc-main";
import { handle } from "../../ipc-kit/handle";
import { automationsService } from "./automations.service";
import type { CreateAutomationInput, UpdateAutomationInput } from "./automations.dto";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

// ─────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────
export function registerAutomationsIpc() {
  ipcMain.handle(
    CHANNELS.automations.getAll,
    handle(() => automationsService.getAll()),
  );

  ipcMain.handle(
    CHANNELS.automations.getById,
    handle((id: string) => automationsService.getById(id)),
  );

  ipcMain.handle(
    CHANNELS.automations.create,
    handle((accountId: string, input: CreateAutomationInput) => automationsService.create(accountId, input)),
  );

  ipcMain.handle(
    CHANNELS.automations.update,
    handle((id: string, input: UpdateAutomationInput) => automationsService.update(id, input)),
  );

  ipcMain.handle(
    CHANNELS.automations.delete,
    handle((id: string) => automationsService.delete(id)),
  );

  ipcMain.handle(
    CHANNELS.automations.execute,
    handle((id: string) => automationsService.executeAutomation(id)),
  );

  ipcMain.handle(
    CHANNELS.automations.getRunHistory,
    handle((automationId: string, limit?: number) => automationsService.getRunHistory(automationId, limit)),
  );

  ipcMain.handle(
    CHANNELS.automations.getAvailableActions,
    handle(() => automationsService.getAvailableActions()),
  );
}

export function unregisterAutomationsIpc() {
  ipcMain.removeHandler(CHANNELS.automations.getAll);
  ipcMain.removeHandler(CHANNELS.automations.getById);
  ipcMain.removeHandler(CHANNELS.automations.create);
  ipcMain.removeHandler(CHANNELS.automations.update);
  ipcMain.removeHandler(CHANNELS.automations.delete);
  ipcMain.removeHandler(CHANNELS.automations.execute);
  ipcMain.removeHandler(CHANNELS.automations.getRunHistory);
  ipcMain.removeHandler(CHANNELS.automations.getAvailableActions);
}
