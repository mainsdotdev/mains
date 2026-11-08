// @vitest-environment jsdom
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import { providersApi } from "@/lib/redux/api/providersApi";
import { onTransportChange, resetTransport, setTransport } from "@/lib/transport/registry";
import type { Transport } from "@/lib/transport/types";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { usePluginCatalog } from "./use-plugin-catalog";

function createStore() {
  return configureStore({ reducer: { api: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware) });
}
function backend() {
  const requests: Array<{ args: unknown[]; finish: (value: ServiceResponse<unknown>) => void }> = [];
  const invoke = vi.fn((channel: string, args: unknown[] = []) => channel === CHANNELS.providers.getPlugins
    ? new Promise<ServiceResponse<unknown>>((finish) => { requests.push({ args, finish }); })
    : Promise.resolve({ success: true, data: undefined } as const));
  const transport: Transport = { kind: "fixture", invoke, subscribe: () => () => {},
    status: () => "connected", onStatusChange: () => () => {} };
  return { requests, invoke, transport };
}
const catalog = (name: string) => ({ marketplaces: [{ name, path: "", interface: null, plugins: [] }],
  marketplaceLoadErrors: [], remoteSyncError: null, featuredPluginIds: [] });
let store: ReturnType<typeof createStore>;
let remote: ReturnType<typeof backend>;
function Wrapper({ children }: { children: ReactNode }) { return <Provider store={store}>{children}</Provider>; }
beforeEach(() => { store = createStore(); remote = backend(); setTransport(remote.transport); });
afterEach(() => { cleanup(); store.dispatch(baseApi.util.resetApiState()); resetTransport(); });

describe("plugin catalog page lifetime", () => {
  it("restarts a cancelled query while its page is still visible", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(1));
    act(() => { store.dispatch(providersApi.util.getRunningQueryThunk("getProviderPlugins", "codex"))!.abort(); });
    await waitFor(() => expect(remote.requests).toHaveLength(2));
    expect(page.result.current.error).toBeUndefined();
    await act(async () => { remote.requests[1].finish({ success: true, data: catalog("recovered") }); });
    await waitFor(() => expect(page.result.current.data?.marketplaces[0].name).toBe("recovered"));
  });

  it("does not cancel the visible reader when an overlapping view leaves", async () => {
    const departing = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(1));
    const visible = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    departing.unmount();
    await act(async () => { remote.requests[0].finish({ success: true, data: catalog("visible") }); });
    await waitFor(() => expect(visible.result.current.data?.marketplaces[0].name).toBe("visible"));
    expect(remote.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.cancelPluginCatalog)).toHaveLength(0);
  });

  it("cancels an automatic refresh only after the last overlapping reader leaves", async () => {
    const first = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await act(async () => { remote.requests[0].finish({ success: true, data: catalog("cached") }); });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    const second = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    act(() => { store.dispatch(baseApi.util.invalidateTags([{ type: "ProviderPlugins", id: "codex" }])); });
    await waitFor(() => expect(remote.requests).toHaveLength(2));
    first.unmount();
    expect(remote.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.cancelPluginCatalog)).toHaveLength(0);
    second.unmount();
    expect(remote.invoke).toHaveBeenCalledWith(CHANNELS.providers.cancelPluginCatalog, remote.requests[1].args);
  });

  it("keeps genuine failures visible without automatically retrying them", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await act(async () => { remote.requests[0].finish({ success: false, error: "Backend unavailable" }); });
    await waitFor(() => expect(page.result.current.error).toBe("Backend unavailable"));
    expect(page.result.current.isLoading).toBe(false);
    expect(remote.requests).toHaveLength(1);
  });

  it("does not restart a cancelled query after the page has left", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(1));
    act(() => { store.dispatch(providersApi.util.getRunningQueryThunk("getProviderPlugins", "codex"))!.abort(); });
    page.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(remote.requests).toHaveLength(1);
  });

  it("rebinds overlapping readers after the real backend-switch cache reset", async () => {
    // The shared app store registers its cache-reset listener before pages bind.
    const off = onTransportChange(() => store.dispatch(baseApi.util.resetApiState()));
    try {
      const first = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
      await waitFor(() => expect(remote.requests).toHaveLength(1));
      const second = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
      const replacement = backend();
      act(() => { setTransport(replacement.transport); });
      await waitFor(() => expect(replacement.requests).toHaveLength(1));
      await act(async () => { replacement.requests[0].finish({ success: true, data: catalog("new backend") }); });
      await waitFor(() => {
        expect(first.result.current.data?.marketplaces[0].name).toBe("new backend");
        expect(second.result.current.data?.marketplaces[0].name).toBe("new backend");
      });
      expect(remote.invoke).toHaveBeenCalledWith(CHANNELS.providers.cancelPluginCatalog, remote.requests[0].args);
      expect(replacement.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.cancelPluginCatalog)).toHaveLength(0);
    } finally { off(); }
  });

  it("cancels loading on exit, ignores late success and loads again when the page returns", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(1));
    const first = remote.requests[0];
    page.unmount();
    expect(remote.invoke).toHaveBeenCalledWith(CHANNELS.providers.cancelPluginCatalog, first.args);
    await act(async () => { first.finish({ success: true, data: catalog("old") }); });
    expect(providersApi.endpoints.getProviderPlugins.select("codex")(store.getState()).data).toBeUndefined();
    const returning = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(2));
    await act(async () => { remote.requests[1].finish({ success: true, data: catalog("fresh") }); });
    await waitFor(() => expect(returning.result.current.data?.marketplaces[0].name).toBe("fresh"));
  });

  it("preserves a completed catalog for the next visit without another request", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await act(async () => { remote.requests[0].finish({ success: true, data: catalog("cached") }); });
    await waitFor(() => expect(page.result.current.data).toBeDefined());
    page.unmount();
    const returning = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    expect(returning.result.current.data?.marketplaces[0].name).toBe("cached");
    expect(remote.requests).toHaveLength(1);
    expect(remote.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.cancelPluginCatalog)).toHaveLength(0);
  });

  it("can return before the cancelled transport reply arrives", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(1));
    page.unmount();
    const returning = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(2));
    await act(async () => { remote.requests[1].finish({ success: true, data: catalog("current") }); });
    await waitFor(() => expect(returning.result.current.data?.marketplaces[0].name).toBe("current"));
    await act(async () => { remote.requests[0].finish({ success: true, data: catalog("late") }); });
    expect(returning.result.current.data?.marketplaces[0].name).toBe("current");
  });

  it("cancels an automatic refresh when the catalog page leaves", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await act(async () => { remote.requests[0].finish({ success: true, data: catalog("cached") }); });
    await waitFor(() => expect(page.result.current.data).toBeDefined());
    act(() => { store.dispatch(baseApi.util.invalidateTags([{ type: "ProviderPlugins", id: "codex" }])); });
    await waitFor(() => expect(remote.requests).toHaveLength(2));
    page.unmount();
    expect(remote.invoke).toHaveBeenCalledWith(CHANNELS.providers.cancelPluginCatalog, remote.requests[1].args);
    const returning = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(3));
    await act(async () => { remote.requests[2].finish({ success: true, data: catalog("updated") }); });
    await waitFor(() => expect(returning.result.current.data?.marketplaces[0].name).toBe("updated"));
  });

  it("cancels the old provider when selection changes", async () => {
    const page = renderHook(({ id }) => usePluginCatalog(id), { initialProps: { id: "codex" }, wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(1));
    page.rerender({ id: "claude_code" });
    expect(remote.invoke).toHaveBeenCalledWith(CHANNELS.providers.cancelPluginCatalog, remote.requests[0].args);
    await waitFor(() => expect(remote.requests).toHaveLength(2));
    expect(remote.requests[1].args[0]).toBe("claude_code");
  });

  it("sends cancellation to the captured backend and starts discovery on its replacement", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), { wrapper: Wrapper });
    await waitFor(() => expect(remote.requests).toHaveLength(1));
    const replacement = backend();
    act(() => { setTransport(replacement.transport); });
    expect(remote.invoke).toHaveBeenCalledWith(CHANNELS.providers.cancelPluginCatalog, remote.requests[0].args);
    await waitFor(() => expect(replacement.requests).toHaveLength(1));
    await act(async () => {
      remote.requests[0].finish({ success: true, data: catalog("retired") });
      replacement.requests[0].finish({ success: true, data: catalog("replacement") });
    });
    await waitFor(() => expect(page.result.current.data?.marketplaces[0].name).toBe("replacement"));
  });

  it("survives StrictMode effect replay with a fresh request", async () => {
    const page = renderHook(() => usePluginCatalog("codex"), {
      wrapper: Wrapper, reactStrictMode: true,
    });
    await waitFor(() => expect(remote.requests).toHaveLength(2));
    await act(async () => {
      remote.requests[0].finish({ success: true, data: catalog("retired") });
      remote.requests[1].finish({ success: true, data: catalog("active") });
    });
    await waitFor(() => expect(page.result.current.data?.marketplaces[0].name).toBe("active"));
  });
});
