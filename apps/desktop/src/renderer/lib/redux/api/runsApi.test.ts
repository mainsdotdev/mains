import { configureStore } from "@reduxjs/toolkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "../../../../shared/ipc-kit/service-response";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import {
  resetTransport,
  setTransport,
  type Transport,
} from "../../transport";
import { baseApi } from "./baseApi";
import { runsApi } from "./runsApi";
import { workspaceApi } from "./workspaceApi";
import workspaceReducer, { activateWorkspaceView, setDraftText } from "../slices/workspaceSlice";
import appSettingsReducer, { setBrowserPanelOpen, setRightPaneContextKey } from "../slices/appSettingsSlice";
import backendsReducer from "../slices/backendsSlice";

function createStore() {
  return configureStore({
    reducer: {
      [baseApi.reducerPath]: baseApi.reducer,
      workspace: workspaceReducer,
      appSettings: appSettingsReducer,
      backends: backendsReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(baseApi.middleware),
  });
}

describe("archived runs cache", () => {
  afterEach(() => {
    resetTransport();
  });

  it("refreshes after run and workspace archive state changes", async () => {
    let workspaceArchived = true;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === CHANNELS.runs.listArchived) {
        return ok([
          {
            id: "r1",
            workspace: {
              id: "w1",
              name: "Workspace",
              isArchived: workspaceArchived,
            },
          },
        ]);
      }
      if (channel === CHANNELS.runs.archive) return ok({ id: "r2" });
      if (channel === CHANNELS.workspace.unarchive) {
        workspaceArchived = false;
        return ok({ id: "w1", isArchived: false });
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const transport: Transport = {
      kind: "test",
      invoke,
      subscribe: () => () => undefined,
      status: () => "connected",
      onStatusChange: () => () => undefined,
    };
    setTransport(transport);
    const store = createStore();
    const subscription = store.dispatch(
      runsApi.endpoints.listArchivedRuns.initiate(),
    );

    await subscription.unwrap();
    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === CHANNELS.runs.listArchived,
      ),
    ).toHaveLength(1);

    await store.dispatch(runsApi.endpoints.archiveRun.initiate("r2")).unwrap();
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([channel]) => channel === CHANNELS.runs.listArchived,
        ),
      ).toHaveLength(2),
    );

    await store
      .dispatch(workspaceApi.endpoints.unarchiveWorkspace.initiate("w1"))
      .unwrap();
    await vi.waitFor(() => {
      expect(
        invoke.mock.calls.filter(
          ([channel]) => channel === CHANNELS.runs.listArchived,
        ),
      ).toHaveLength(3);
      expect(
        runsApi.endpoints.listArchivedRuns.select()(store.getState()).data?.[0]
          .workspace?.isArchived,
      ).toBe(false);
    });

    subscription.unsubscribe();
    store.dispatch(baseApi.util.resetApiState());
  });
});

describe("permanent deletion UI cleanup", () => {
  afterEach(() => {
    resetTransport();
    vi.unstubAllGlobals();
  });

  it("clears a chat's persisted UI state only after the backend deletes it", async () => {
    let shouldFail = true;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === CHANNELS.runs.delete) return shouldFail ? fail("cannot delete") : ok(undefined);
      throw new Error(`Unexpected channel: ${channel}`);
    });
    setTransport({
      kind: "test", invoke, subscribe: () => () => undefined,
      status: () => "connected", onStatusChange: () => () => undefined,
    });
    const store = createStore();
    const owner = runOwnerKey("local", "run-a");
    store.dispatch(setDraftText({ key: owner, text: "unfinished" }));
    store.dispatch(setRightPaneContextKey(owner));
    store.dispatch(setBrowserPanelOpen(true));

    await expect(store.dispatch(runsApi.endpoints.deleteRun.initiate("run-a")).unwrap()).rejects.toBeTruthy();
    expect(store.getState().workspace.draftTextByKey[owner]).toBe("unfinished");
    expect(store.getState().appSettings.browserPanelOpen).toBe(true);

    shouldFail = false;
    await store.dispatch(runsApi.endpoints.deleteRun.initiate("run-a")).unwrap();
    expect(store.getState().workspace.draftTextByKey[owner]).toBeUndefined();
    expect(store.getState().appSettings.activeRightPaneContextKey).toBe("default");
    expect(store.getState().appSettings.browserPanelOpen).toBe(false);
  });

  it("clears a deleted workspace's view and unsent draft", async () => {
    let finishListRefresh!: (value: ReturnType<typeof ok<unknown>>) => void;
    const listRefresh = new Promise<ReturnType<typeof ok<unknown>>>((resolve) => {
      finishListRefresh = resolve;
    });
    let listReads = 0;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === CHANNELS.workspace.list) {
        listReads += 1;
        return listReads === 1 ? ok([{ id: "ws-a" }, { id: "ws-b" }]) : listRefresh;
      }
      if (channel === CHANNELS.workspace.delete) return ok(undefined);
      throw new Error(`Unexpected channel: ${channel}`);
    });
    setTransport({
      kind: "test", invoke, subscribe: () => () => undefined,
      status: () => "connected", onStatusChange: () => () => undefined,
    });
    const store = createStore();
    const listSubscription = store.dispatch(workspaceApi.endpoints.listWorkspaces.initiate());
    await listSubscription.unwrap();
    const view = JSON.stringify(["local", "space", "codex", "developer", "ws-a"]);
    const draft = JSON.stringify(["local", "draft", "space", "codex", "developer", "ws-a", null]);
    store.dispatch(activateWorkspaceView({ key: view, workspaceId: "ws-a", providerId: "codex" }));
    store.dispatch(setDraftText({ key: draft, text: "unsent" }));

    await store.dispatch(workspaceApi.endpoints.deleteWorkspace.initiate({ id: "ws-a" })).unwrap();

    expect(store.getState().workspace.workspaceViewKey).toBeNull();
    expect(store.getState().workspace.draftTextByKey[draft]).toBeUndefined();
    expect(workspaceApi.endpoints.listWorkspaces.select()(store.getState()).data?.map((workspace) => workspace.id))
      .toEqual(["ws-b"]);
    expect(invoke).toHaveBeenCalledWith(CHANNELS.workspace.delete, ["ws-a", { removeWorktree: undefined }]);
    finishListRefresh(ok([{ id: "ws-b" }]));
    listSubscription.unsubscribe();
  });

  it("does not hold a successful delete open while browser cleanup is pending", async () => {
    let finishBrowser!: (value: { success: true; data: unknown }) => void;
    const browserCleanup = new Promise<{ success: true; data: unknown }>((resolve) => {
      finishBrowser = resolve;
    });
    const forgetContext = vi.fn(() => browserCleanup);
    vi.stubGlobal("window", { api: { browser: { forgetContext } } });
    setTransport({
      kind: "test", invoke: async () => ok(undefined), subscribe: () => () => undefined,
      status: () => "connected", onStatusChange: () => () => undefined,
    });
    const store = createStore();

    await expect(Promise.race([
      store.dispatch(runsApi.endpoints.deleteRun.initiate("run-stalled-browser")).unwrap(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("delete waited for browser")), 250)),
    ])).resolves.toBeUndefined();
    expect(forgetContext).toHaveBeenCalledOnce();
    finishBrowser({ success: true, data: {} });
  });
});
