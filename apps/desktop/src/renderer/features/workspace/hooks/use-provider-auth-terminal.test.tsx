// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import reducer from "@/lib/redux/slices/workspaceSlice";
import { getTransport, setTransport } from "@/lib/transport/registry";
import { IpcTransport } from "@/lib/transport/ipc-transport";
import { useProviderAuthTerminal } from "./use-provider-auth-terminal";

function mount() {
  const store = configureStore({ reducer: { workspace: reducer } });
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
  return { store, ...renderHook(useProviderAuthTerminal, { wrapper }) };
}
describe("provider sign-in ownership", () => {
  it("scopes callbacks to the login that created them", () => {
    const view = mount();
    act(() => view.result.current.open("codex", "codex login"));
    const markOld = view.result.current.markCommandSent, closeOld = view.result.current.close;
    act(() => view.result.current.open("claude_code", "claude auth login"));
    const current = view.result.current.session;
    act(() => { markOld(); closeOld(); });
    expect(view.result.current.session).toEqual(current);
    act(() => view.result.current.markCommandSent());
    expect(view.result.current.session?.pendingCommand).toBeNull();
    view.unmount();
  });

  it("retires login on the first backend switch and does not revive it when switching back", () => {
    const original = getTransport(), view = mount();
    try {
      act(() => view.result.current.open("codex", "codex login"));
      const old = view.result.current.markCommandSent;
      act(() => { setTransport(new IpcTransport()); setTransport(original); });
      expect(view.result.current.session).toBeNull();
      act(() => view.result.current.open("codex", "codex login"));
      act(old);
      expect(view.result.current.session?.pendingCommand).toBe("codex login");
    } finally { view.unmount(); setTransport(original); }
  });
});
