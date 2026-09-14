import { configureStore } from "@reduxjs/toolkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../../../shared/ipc-kit/service-response";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import {
  resetTransport,
  setTransport,
  type Transport,
} from "../../transport";
import { baseApi } from "./baseApi";
import { runsApi } from "./runsApi";
import { workspaceApi } from "./workspaceApi";

function createStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
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
