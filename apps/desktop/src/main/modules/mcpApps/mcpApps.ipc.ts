import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { handle } from "../../ipc-kit";
import { ipcMain } from "../../ipc-kit/ipc-main";
import type {
  CallMcpAppToolPayload,
  ReadMcpAppResourcePayload,
  SendMcpAppMessagePayload,
} from "./mcpApps.dto";
import { mcpAppsService } from "./mcpApps.service";

export function registerMcpAppsIpc(): void {
  ipcMain.handle(
    CHANNELS.mcpApps.readResource,
    handle((payload: ReadMcpAppResourcePayload) => mcpAppsService.readResource(payload)),
  );
  ipcMain.handle(
    CHANNELS.mcpApps.callTool,
    handle((payload: CallMcpAppToolPayload) => mcpAppsService.callTool(payload)),
  );
  ipcMain.handle(
    CHANNELS.mcpApps.sendMessage,
    handle((payload: SendMcpAppMessagePayload) => mcpAppsService.sendMessage(payload)),
  );
}

export function unregisterMcpAppsIpc(): void {
  ipcMain.removeHandler(CHANNELS.mcpApps.readResource);
  ipcMain.removeHandler(CHANNELS.mcpApps.callTool);
  ipcMain.removeHandler(CHANNELS.mcpApps.sendMessage);
}
