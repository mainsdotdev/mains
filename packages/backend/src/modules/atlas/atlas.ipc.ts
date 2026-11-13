import { CHANNELS } from "@mains/contracts/channels";
import type { AtlasAutoTagging, AtlasSaveBookmark, AtlasCreatePage, AtlasGeneratedOptions, AtlasIdentity, AtlasLibraryOptions, AtlasListOptions, AtlasSaveFile,
  AtlasSavePage, AtlasSetCoverPreset, AtlasUpdateItem, AtlasUploadFile, AtlasRestorePage, AtlasResolveConflict } from "@mains/contracts/atlas";
import { handle } from "../../ipc-kit/handle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { atlasService } from "./atlas.service";
import { atlasBookmarks } from "./atlas.bookmarks";
import { atlasMobile } from "./atlas.mobile";
import type { AtlasMobileLibraryOptions, AtlasMobilePageRequest, AtlasMobileFileRequest, AtlasMobileFileRead, AtlasMobileSaveFile, AtlasMobileSaveBookmark, AtlasMobileUpdateItem, AtlasMobileBookmarkIdentity, AtlasMobileEditBookmark, AtlasMobileTrashOptions, AtlasMobileSetTrash } from "@mains/contracts/atlas-mobile";

export function registerAtlasIpc() {
  ipcMain.handle(CHANNELS.atlas.mobileTrash, handle((input: AtlasMobileTrashOptions) => atlasMobile.trash(input)));
  ipcMain.handle(CHANNELS.atlas.setMobileTrash, handle((input: AtlasMobileSetTrash) => atlasMobile.setTrash(input)));
  ipcMain.handle(CHANNELS.atlas.readMobileBookmark, handle((input: AtlasMobileBookmarkIdentity) => atlasMobile.readBookmark(input)));
  ipcMain.handle(CHANNELS.atlas.editMobileBookmark, handle((input: AtlasMobileEditBookmark) => atlasMobile.editBookmark(input)));
  ipcMain.handle(CHANNELS.atlas.updateMobileItem, handle((input: AtlasMobileUpdateItem) => atlasMobile.updateItem(input)));
  ipcMain.handle(CHANNELS.atlas.saveMobileFile, handle((input: AtlasMobileSaveFile) => atlasMobile.saveFile(input)));
  ipcMain.handle(CHANNELS.atlas.saveMobileBookmark, handle((input: AtlasMobileSaveBookmark) => atlasMobile.saveBookmark(input)));
  ipcMain.handle(CHANNELS.atlas.mobileLibrary, handle((input: AtlasMobileLibraryOptions) => atlasMobile.library(input)));
  ipcMain.handle(CHANNELS.atlas.readMobilePage, handle((input: AtlasMobilePageRequest) => atlasMobile.readPage(input)));
  ipcMain.handle(CHANNELS.atlas.describeMobileFile, handle((input: AtlasMobileFileRequest) => atlasMobile.describeFile(input)));
  ipcMain.handle(CHANNELS.atlas.readMobileFile, handle((input: AtlasMobileFileRead) => atlasMobile.readFile(input)));
  ipcMain.handle(CHANNELS.atlas.saveBookmark, handle((input: AtlasSaveBookmark) => atlasService.saveBookmark(input)));
  ipcMain.handle(CHANNELS.atlas.enrichBookmark, handle((input: AtlasIdentity) => atlasService.enrichBookmark(input)));
  ipcMain.handle(CHANNELS.atlas.listTags, handle((input: { accountId: string }) => atlasService.listTags(input)));
  ipcMain.handle(CHANNELS.atlas.renameTag, handle((input: AtlasIdentity & { name: string }) => atlasService.renameTag(input)));
  ipcMain.handle(CHANNELS.atlas.removeTag, handle((input: AtlasIdentity) => atlasService.removeTag(input)));
  ipcMain.handle(CHANNELS.atlas.setTags, handle((input: AtlasIdentity & { tags: string[] }) => atlasService.setTags(input)));
  ipcMain.handle(CHANNELS.atlas.getAutoTagging, handle((input: { accountId: string }) => atlasService.getAutoTagging(input)));
  ipcMain.handle(CHANNELS.atlas.setAutoTagging, handle((input: { accountId: string; config: AtlasAutoTagging }) => atlasService.setAutoTagging(input)));
  ipcMain.handle(CHANNELS.atlas.list, handle((options: AtlasListOptions) => atlasService.list(options)));
  ipcMain.handle(CHANNELS.atlas.library, handle((options: AtlasLibraryOptions) => atlasService.library(options)));
  ipcMain.handle(CHANNELS.atlas.generated, handle((options: AtlasGeneratedOptions) => atlasService.generated(options)));
  ipcMain.handle(CHANNELS.atlas.get, handle(async (options: AtlasIdentity) => {
    const item = atlasService.get(options);
    return item?.kind === "page" ? atlasService.getPage(options) : item?.kind === "bookmark" ? item : item ? { ...item, path: await atlasService.resolveFile(options) } : null;
  }));
  ipcMain.handle(CHANNELS.atlas.createPage, handle((input: AtlasCreatePage) => atlasService.createPage(input)));
  ipcMain.handle(CHANNELS.atlas.savePage, handle((input: AtlasSavePage) => atlasService.savePage(input)));
  ipcMain.handle(CHANNELS.atlas.revisions, handle((options: AtlasIdentity) => atlasService.revisions(options)));
  ipcMain.handle(CHANNELS.atlas.restore, handle((input: AtlasRestorePage) => atlasService.restore(input)));
  ipcMain.handle(CHANNELS.atlas.getRevision, handle((input: AtlasIdentity & { revisionId: string }) => atlasService.getRevision(input)));
  ipcMain.handle(CHANNELS.atlas.resolveConflict, handle((input: AtlasResolveConflict) => atlasService.resolveConflict(input)));
  ipcMain.handle(CHANNELS.atlas.resolveFile, handle((input: AtlasIdentity) => atlasService.resolveFile(input)));
  ipcMain.handle(CHANNELS.atlas.saveFile, handle((input: AtlasSaveFile) => atlasService.saveFile(input)));
  ipcMain.handle(CHANNELS.atlas.uploadFile, handle((input: AtlasUploadFile) => atlasService.uploadFile(input)));
  ipcMain.handle(CHANNELS.atlas.update, handle((input: AtlasUpdateItem) => atlasService.update(input)));
  ipcMain.handle(CHANNELS.atlas.setCoverPreset, handle((input: AtlasSetCoverPreset) => atlasService.setCoverPreset(input)));
  ipcMain.handle(CHANNELS.atlas.remove, handle((input: AtlasIdentity) => atlasService.remove(input)));
  atlasBookmarks.start();
}
export function unregisterAtlasIpc() {
  const closing = shutdownAtlasBookmarks();
  Object.values(CHANNELS.atlas).forEach((channel) => ipcMain.removeHandler(channel));
  return closing;
}
export function shutdownAtlasBookmarks() { return atlasBookmarks.stop(); }
