import { configureStore } from "@reduxjs/toolkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "./baseApi";
import { pullRequestsApi } from "./pullRequestsApi";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { deferred, prFixture } from "@/features/pull-requests/components/pull-request-test-fixtures";

const ref = { provider: "github", owner: "acme", repo: "widget", number: 176 };
const stores: ReturnType<typeof makeStore>[] = [];
function makeStore() {
  return configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
}
function transport(invoke: Transport["invoke"]): Transport {
  return { kind: "test", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} };
}
afterEach(() => { for (const store of stores.splice(0)) store.dispatch(baseApi.util.resetApiState()); resetTransport(); });

describe("PR provider response ownership", () => {
  it("does not refresh the replacement backend after an old merge completes", async () => {
    const receipt = deferred<any>();
    setTransport(transport(async (channel) => channel === CHANNELS.pullRequests.merge
      ? receipt.promise : { success: true, data: prFixture }));
    const store = makeStore();
    stores.push(store);
    await store.dispatch(pullRequestsApi.endpoints.getPrDetail.initiate(ref));
    const merge = store.dispatch(pullRequestsApi.endpoints.mergePr.initiate(ref));
    const invokeB = vi.fn(async () => ({ success: true as const, data: { ...prFixture, title: "Backend B" } }));
    setTransport(transport(invokeB));
    store.dispatch(baseApi.util.resetApiState());
    await store.dispatch(pullRequestsApi.endpoints.getPrDetail.initiate(ref));
    expect(invokeB).toHaveBeenCalledTimes(1);
    receipt.resolve({ success: true });
    await merge;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invokeB).toHaveBeenCalledTimes(1);
  });
});
