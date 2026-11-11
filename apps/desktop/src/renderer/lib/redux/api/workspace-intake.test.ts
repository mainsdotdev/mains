import { configureStore } from "@reduxjs/toolkit";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { ok, type ServiceResponse } from "@mains/contracts/service-response";
import { setTransport, resetTransport, type Transport } from "@/lib/transport";
import { baseApi } from "./baseApi";
import { accountApi, type Account } from "./accountApi";
import { workspaceApi, type Workspace } from "./workspaceApi";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); resetTransport(); });
async function harness() {
  const store = configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (defaults) => defaults({ serializableCheck: false }).concat(baseApi.middleware) });
  let finish!: (result: ServiceResponse<unknown>) => void;
  const response = new Promise<ServiceResponse<unknown>>((resolve) => { finish = resolve; });
  let reads = 0;
  const refreshes: Array<(result: ServiceResponse<unknown>) => void> = [];
  const transport: Transport = {
    kind: "fixture", status: () => "connected", subscribe: () => () => {}, onStatusChange: () => () => {},
    async invoke(channel) {
      if (channel === CHANNELS.workspace.list) {
        if (reads++ === 0) return ok([]);
        return new Promise<ServiceResponse<unknown>>((resolve) => { refreshes.push(resolve); });
      }
      if (channel === CHANNELS.workspace.createFromSource) return response;
      throw new Error(`Unexpected channel ${channel}`);
    },
  };
  setTransport(transport);
  await store.dispatch(accountApi.util.upsertQueryData("getAccount", undefined, { id: "account" } as Account));
  const list = store.dispatch(workspaceApi.endpoints.listWorkspaces.initiate()); await list.unwrap();
  const snapshots: string[][] = [];
  const off = store.subscribe(() => { snapshots.push((workspaceApi.endpoints.listWorkspaces.select()(store.getState()).data ?? []).map((row) => row.id)); });
  cleanup.push(() => store.dispatch(baseApi.util.resetApiState()), () => list.unsubscribe(), () => { for (const finish of refreshes) finish(ok([])); }, off);
  const pending = store.dispatch(workspaceApi.endpoints.createWorkspaceFromSource.initiate({ accountId: "account", source: { kind: "folder", path: "/repo" } }));
  return { store, transport, snapshots, pending, finish, rows: () => workspaceApi.endpoints.listWorkspaces.select()(store.getState()).data ?? [] };
}
describe("intake cache ownership", () => {
  it("does not insert an old account's workspace into the new account's visible cache", async () => {
    const h = await harness();
    await h.store.dispatch(accountApi.util.upsertQueryData("getAccount", undefined, { id: "other" } as Account));
    h.finish(ok({ id: "old-workspace", accountId: "account" } as Workspace)); await h.pending.unwrap();
    expect(h.snapshots.some((rows) => rows.includes("old-workspace"))).toBe(false);
    expect(h.rows().some((row) => row.id === "old-workspace")).toBe(false);
  });

  it("merges the accepted workspace before a slow refresh when the account and transport still own it", async () => {
    const h = await harness();
    h.finish(ok({ id: "new-workspace", accountId: "account" } as Workspace)); await h.pending.unwrap();
    expect(h.rows().map((row) => row.id)).toEqual(["new-workspace"]);
  });

  it("retires optimistic cache projection on any transport swap, including a round trip", async () => {
    const h = await harness();
    setTransport({ ...h.transport }); setTransport(h.transport);
    h.finish(ok({ id: "old-workspace", accountId: "account" } as Workspace)); await h.pending.unwrap();
    expect(h.rows().some((row) => row.id === "old-workspace")).toBe(false);
  });
});
