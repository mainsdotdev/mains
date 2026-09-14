import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { handle } from "../../ipc-kit/handle";
import { ipcMain } from "../../ipc-kit/ipc-main";
import type {
  CollectionIdentityOptions,
  ListCollectionsOptions,
  ListCollectionSourcesOptions,
  RemoveCollectionSourcePayload,
} from "./collections.dto";
import { collectionsService } from "./collections.service";

export function registerCollectionsIpc(): void {
  ipcMain.handle(
    CHANNELS.collections.list,
    handle((options: ListCollectionsOptions) => collectionsService.list(options)),
  );
  ipcMain.handle(
    CHANNELS.collections.get,
    handle((options: CollectionIdentityOptions) => collectionsService.get(options)),
  );
  ipcMain.handle(
    CHANNELS.collections.create,
    handle((payload: unknown) => collectionsService.create(payload)),
  );
  ipcMain.handle(
    CHANNELS.collections.update,
    handle((options: CollectionIdentityOptions, payload: unknown) =>
      collectionsService.update(options, payload),
    ),
  );
  ipcMain.handle(
    CHANNELS.collections.archive,
    handle((options: CollectionIdentityOptions) =>
      collectionsService.archive(options),
    ),
  );
  ipcMain.handle(
    CHANNELS.collections.unarchive,
    handle((options: CollectionIdentityOptions) =>
      collectionsService.unarchive(options),
    ),
  );
  ipcMain.handle(
    CHANNELS.collections.remove,
    handle((options: CollectionIdentityOptions) =>
      collectionsService.remove(options),
    ),
  );
  ipcMain.handle(
    CHANNELS.collections.listSources,
    handle((options: ListCollectionSourcesOptions) =>
      collectionsService.listSources(options),
    ),
  );
  ipcMain.handle(
    CHANNELS.collections.addSource,
    handle((payload: unknown) => collectionsService.addSource(payload)),
  );
  ipcMain.handle(
    CHANNELS.collections.removeSource,
    handle((payload: RemoveCollectionSourcePayload) =>
      collectionsService.removeSource(payload),
    ),
  );
}

export function unregisterCollectionsIpc(): void {
  Object.values(CHANNELS.collections).forEach((channel) =>
    ipcMain.removeHandler(channel),
  );
}
