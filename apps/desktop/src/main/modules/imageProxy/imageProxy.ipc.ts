import { ok, fail } from "../../../shared/ipc-kit/service-response";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { imageProxyService } from "./imageProxy.service";
import { CHANNELS } from "../../../shared/ipc-kit/channels";

export function registerImageProxyIpc() {
  ipcMain.handle(CHANNELS.imageProxy.sign, (_, rawPath: string) => {
    const url = imageProxyService.signLocalImageUrl(rawPath);
    if (!url) {
      return fail("Invalid path");
    }
    return ok(url);
  });

  ipcMain.handle(CHANNELS.documents.sign, (_, rawPath: string) => {
    const url = imageProxyService.signLocalDocumentUrl(rawPath);
    if (!url) {
      return fail("Invalid path");
    }
    return ok(url);
  });
}

export function unregisterImageProxyIpc() {
  ipcMain.removeHandler(CHANNELS.imageProxy.sign);
  ipcMain.removeHandler(CHANNELS.documents.sign);
}
