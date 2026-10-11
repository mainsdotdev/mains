// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import appSettingsReducer, { setBottomTerminalOpen } from "@/lib/redux/slices/appSettingsSlice";
import terminalReducer, { selectTerminal, terminalWorkspaceKey } from "@/lib/redux/slices/terminalSlice";
import { resetTransport, setTransport } from "@/lib/transport";
import { useBottomTerminal } from "./use-bottom-terminal";

const invoke = vi.fn();
function makeStore() {
  return configureStore({ reducer: {
    [baseApi.reducerPath]: baseApi.reducer, appSettings: appSettingsReducer, terminal: terminalReducer,
    workspace: (state = { activeWorkspaceId: "w" }, action) => action.type === "test/workspace" ? { activeWorkspaceId: action.payload } : state,
    backends: (state = { activeBackendId: "local" }, action) => action.type === "test/backend" ? { activeBackendId: action.payload } : state,
  }, middleware: (defaults) => defaults().concat(baseApi.middleware) });
}
let store: ReturnType<typeof makeStore>;
function wrapper({ children }: { children: ReactNode }) { return <Provider store={store}>{children}</Provider>; }

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ success: true, data: [] });
  setTransport({ kind: "test", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} });
  store = makeStore();
});
afterEach(() => { cleanup(); store.dispatch(baseApi.util.resetApiState()); resetTransport(); });

describe("terminal panel hide lifecycle", () => {
  it.each(["close", "toggle"] as const)("starts workspace cleanup through %s and hides immediately without waiting for it", async (method) => {
    let finish!: (response: { success: true; data: string[] }) => void;
    invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    store.dispatch(setBottomTerminalOpen(true));
    store.dispatch(selectTerminal({ key: terminalWorkspaceKey("local", "w"), id: "idle" }));
    const { result } = renderHook(useBottomTerminal, { wrapper });
    act(() => result.current[method]());
    expect(result.current.isOpen).toBe(false);
    expect(invoke).toHaveBeenCalledWith(CHANNELS.terminal.destroyIdle, ["w"]);
    act(() => finish({ success: true, data: ["idle"] }));
    await waitFor(() => expect(store.getState().terminal.selectedByWorkspace[terminalWorkspaceKey("local", "w")]).toBeUndefined());
  });

  it("does not clean up when opening, changing workspace or unmounting a view", () => {
    const { result, unmount } = renderHook(useBottomTerminal, { wrapper });
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
    act(() => store.dispatch({ type: "test/workspace", payload: "other" }));
    unmount();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("clears old selections against the original backend when the user switches during cleanup", async () => {
    let finish!: (response: { success: true; data: string[] }) => void;
    invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const oldKey = terminalWorkspaceKey("local", "w");
    const newKey = terminalWorkspaceKey("remote", "other");
    store.dispatch(selectTerminal({ key: oldKey, id: "idle" }));
    store.dispatch(selectTerminal({ key: newKey, id: "idle" }));
    const { result } = renderHook(useBottomTerminal, { wrapper });
    act(() => result.current.close());
    act(() => {
      store.dispatch({ type: "test/backend", payload: "remote" });
      store.dispatch({ type: "test/workspace", payload: "other" });
      finish({ success: true, data: ["idle"] });
    });
    await waitFor(() => expect(store.getState().terminal.selectedByWorkspace[oldKey]).toBeUndefined());
    expect(store.getState().terminal.selectedByWorkspace[newKey]).toBe("idle");
  });
});
