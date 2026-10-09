import { CHANNELS } from "@mains/contracts/channels";
import type { AtlasCreatePage, AtlasGeneratedOptions, AtlasIdentity, AtlasListOptions, AtlasSaveFile,
  AtlasSavePage, AtlasUpdateItem, AtlasUploadFile } from "@mains/contracts/atlas";
import { handle } from "../../ipc-kit/handle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { atlasService } from "./atlas.service";

export function registerAtlasIpc() {
  ipcMain.handle(CHANNELS.atlas.list, handle((options: AtlasListOptions) => atlasService.list(options)));
  ipcMain.handle(CHANNELS.atlas.generated, handle((options: AtlasGeneratedOptions) => atlasService.generated(options)));
  ipcMain.handle(CHANNELS.atlas.get, handle((options: AtlasIdentity) => {
    const item = atlasService.get(options);
    return item?.kind === "page" ? atlasService.getPage(options) : item;
  }));
  ipcMain.handle(CHANNELS.atlas.createPage, handle((input: AtlasCreatePage) => atlasService.createPage(input)));
  ipcMain.handle(CHANNELS.atlas.savePage, handle((input: AtlasSavePage) => atlasService.savePage(input)));
  ipcMain.handle(CHANNELS.atlas.revisions, handle((options: AtlasIdentity) => atlasService.revisions(options)));
  ipcMain.handle(CHANNELS.atlas.restore, handle((input: AtlasIdentity & { version: number; expectedVersion: number }) => atlasService.restore(input)));
  ipcMain.handle(CHANNELS.atlas.saveFile, handle((input: AtlasSaveFile) => atlasService.saveFile(input)));
  ipcMain.handle(CHANNELS.atlas.uploadFile, handle((input: AtlasUploadFile) => atlasService.uploadFile(input)));
  ipcMain.handle(CHANNELS.atlas.update, handle((input: AtlasUpdateItem) => atlasService.update(input)));
  ipcMain.handle(CHANNELS.atlas.remove, handle((input: AtlasIdentity) => atlasService.remove(input)));
}
export function unregisterAtlasIpc() {
  Object.values(CHANNELS.atlas).forEach((channel) => ipcMain.removeHandler(channel));
}
