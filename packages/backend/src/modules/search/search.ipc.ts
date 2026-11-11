import type { GlobalSearchQuery, ConversationSearchQuery } from "@mains/contracts/search";
import { CHANNELS } from "@mains/contracts/channels";
import { handle } from "../../ipc-kit/handle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import { searchService } from "./search.service";

export function registerSearchIpc(): void {
  ipcMain.handle(CHANNELS.search.conversations, handle((input: ConversationSearchQuery) => searchService.conversations(input)));
  ipcMain.handle(
    CHANNELS.search.query,
    handle((input: GlobalSearchQuery) => searchService.query(input)),
  );
}

export function unregisterSearchIpc(): void {
  ipcMain.removeHandler(CHANNELS.search.conversations);
  ipcMain.removeHandler(CHANNELS.search.query);
}
