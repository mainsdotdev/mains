import { configureStore } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasItem } from "@mains/contracts/atlas";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "./baseApi";
import { atlasApi } from "./atlasApi";
import atlasReducer, { openAtlasPageTab, updateAtlasPageChat } from "../slices/atlasSlice";
import backendsReducer, { setActiveBackend } from "../slices/backendsSlice";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ invoke: mocks.invoke }) }));

const localOwner = '["local","account"]';
const remoteOwner = '["remote","account"]';
const otherAccount = '["local","other"]';
const page: AtlasItem = {
  id: "page", accountId: "account", kind: "page", title: "Page", metadata: null, collectionId: null,
  sourceRunId: null, sourceKey: null, path: null, fileName: null, mimeType: null, byteSize: null,
  isFavorite: false, trashedAt: "2026-10-07", version: 1, createdAt: "2026-10-06", updatedAt: "2026-10-07",
};
function createStore() {
  return configureStore({ reducer: { atlas: atlasReducer, backends: backendsReducer, [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
}
let store: ReturnType<typeof createStore>;
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (handler) => ({ success: true, data: handler === CHANNELS.atlas.update ? page : undefined }));
  store = createStore();
  for (const ownerKey of [localOwner, remoteOwner, otherAccount]) store.dispatch(openAtlasPageTab({ ownerKey, id: "page" }));
  store.dispatch(openAtlasPageTab({ ownerKey: localOwner, id: "remaining" }));
  store.dispatch(updateAtlasPageChat({ ownerKey: localOwner, id: "page", patch: { draft: "Keep my draft" } }));
});
afterEach(() => store.dispatch(baseApi.util.resetApiState()));

function remove(operation: "trash" | "permanent") {
  const identity = { accountId: "account", id: "page" };
  return operation === "trash"
    ? store.dispatch(atlasApi.endpoints.updateAtlasItem.initiate({ ...identity, trashed: true }))
    : store.dispatch(atlasApi.endpoints.removeAtlasItem.initiate(identity));
}

describe("Atlas deleted Page tabs", () => {
  it.each(["trash", "permanent"] as const)("closes only the owning tab after successful %s deletion", async (operation) => {
    await remove(operation).unwrap();
    await vi.waitFor(() => expect(store.getState().atlas.byOwner[localOwner].tabs).toEqual([{ id: "remaining" }]));
    expect(store.getState().atlas.byOwner[remoteOwner].tabs).toEqual([{ id: "page" }]);
    expect(store.getState().atlas.byOwner[otherAccount].tabs).toEqual([{ id: "page" }]);
    expect(store.getState().atlas.byOwner[localOwner].chats.page.draft).toBe("Keep my draft");
  });

  it.each(["trash", "permanent"] as const)("keeps the tab and draft when %s deletion fails", async (operation) => {
    mocks.invoke.mockResolvedValue({ success: false, error: { message: "Could not delete" } });
    await expect(remove(operation).unwrap()).rejects.toEqual({ message: "Could not delete" });
    expect(store.getState().atlas.byOwner[localOwner].tabs).toEqual([{ id: "page" }, { id: "remaining" }]);
    expect(store.getState().atlas.byOwner[localOwner].chats.page.draft).toBe("Keep my draft");
  });

  it.each(["trash", "permanent"] as const)("retains the original owner when the backend changes during %s deletion", async (operation) => {
    let finish!: (value: { success: true; data: AtlasItem | undefined }) => void;
    mocks.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = remove(operation);
    store.dispatch(setActiveBackend("remote"));
    finish({ success: true, data: operation === "trash" ? page : undefined });
    await pending.unwrap();
    await vi.waitFor(() => expect(store.getState().atlas.byOwner[localOwner].tabs).toEqual([{ id: "remaining" }]));
    expect(store.getState().atlas.byOwner[remoteOwner].tabs).toEqual([{ id: "page" }]);
  });

  it("keeps the tab when restoring a Page or changing its metadata", async () => {
    mocks.invoke.mockResolvedValue({ success: true, data: { ...page, trashedAt: null } });
    await store.dispatch(atlasApi.endpoints.updateAtlasItem.initiate({ accountId: "account", id: "page", trashed: false })).unwrap();
    await store.dispatch(atlasApi.endpoints.updateAtlasItem.initiate({ accountId: "account", id: "page", metadata: { icon: "emoji:😁" } })).unwrap();
    expect(store.getState().atlas.byOwner[localOwner].tabs).toEqual([{ id: "page" }, { id: "remaining" }]);
  });
});
