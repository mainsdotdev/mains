// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import type { Space } from "@/lib/redux/api/spaceApi";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { useImageCreatorSetup } from "./use-image-creator-setup";

const space: Space = { id: "codex", accountId: "account", name: "Codex", slug: "codex", description: null,
  systemPrompt: null, model: null, icon: null, themeConfig: null, providerId: "codex", mode: "chat",
  sortOrder: 0, isArchived: false, createdAt: 1, updatedAt: 1 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const invoke = vi.fn();
let spaces: Space[], failSpaces: boolean, run: any;
const stores: ReturnType<typeof makeStore>[] = [];
function makeStore() { return configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) }); }
function harness(runId?: string) {
  const store = makeStore(); stores.push(store);
  return { store, ...renderHook(() => useImageCreatorSetup("account", runId), { wrapper: ({ children }: { children: ReactNode }) =>
    <StrictMode><Provider store={store}>{children}</Provider></StrictMode> }) };
}
beforeEach(() => {
  spaces = []; failSpaces = false;
  run = { id: "run", accountId: "account", providerId: "codex", mode: "work", spaceId: space.id, collectionId: "collection" };
  invoke.mockImplementation(async (channel) => {
    if (channel === CHANNELS.space.getAll) return failSpaces ? { success: false, error: "Discovery failed" } : { success: true, data: spaces };
    if (channel === CHANNELS.appSettings.get) return { success: true, data: { activeSpaceId: "codex" } };
    if (channel === CHANNELS.space.create) return { success: true, data: { ...space, mode: "work" } };
    if (channel === CHANNELS.runs.getById) return { success: true, data: run };
    throw new Error("Unexpected channel " + channel);
  });
  setTransport({ kind: "test", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} } as Transport);
});
afterEach(() => { cleanup(); for (const store of stores.splice(0)) store.dispatch(baseApi.util.resetApiState()); resetTransport(); vi.clearAllMocks(); });

describe("image creator setup through Redux and transport", () => {
  it("shares one creation through Strict Mode and projects Work without changing the saved mode", async () => {
    const h = harness();
    await waitFor(() => expect(h.result.current.space?.id).toBe("codex"));
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.space.create)).toHaveLength(1);
    expect(h.result.current.space?.mode).toBe("work"); expect(space.mode).toBe("chat");
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.appSettings.update || channel === CHANNELS.space.update)).toBe(false);
  });
  it("retries a failed creation only on an explicit retry", async () => {
    const original = invoke.getMockImplementation()!;
    let rejected = true;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.space.create && rejected
      ? Promise.resolve({ success: false, error: "Create failed" }) : original(channel, args));
    const h = harness();
    await waitFor(() => expect(h.result.current.error).toBe("Create failed"));
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.space.create)).toHaveLength(1);
    rejected = false;
    act(() => { h.result.current.retry(); h.result.current.retry(); });
    await waitFor(() => expect(h.result.current.space?.id).toBe("codex"));
    expect(invoke.mock.calls.filter(([channel]) => channel === CHANNELS.space.create)).toHaveLength(2);
  });
  it("does not create from failed discovery and recovers by refetching", async () => {
    failSpaces = true; const h = harness();
    await waitFor(() => expect(h.result.current.error).toBe("Could not load your spaces."));
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.space.create)).toBe(false);
    failSpaces = false; spaces = [space];
    act(() => h.result.current.retry());
    await waitFor(() => expect(h.result.current.space?.id).toBe("codex"));
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.space.create)).toBe(false);
  });
  it("reuses only an unarchived Codex space from this account", async () => {
    spaces = [{ ...space, id: "foreign", accountId: "other" }, { ...space, id: "archived", isArchived: true }, space];
    const h = harness();
    await waitFor(() => expect(h.result.current.space?.id).toBe("codex"));
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.space.create)).toBe(false);
  });
  it("rejects a creation returned for a different account", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.space.create
      ? Promise.resolve({ success: true, data: { ...space, accountId: "other" } }) : original(channel, args));
    const h = harness();
    await waitFor(() => expect(h.result.current.error).toContain("not available for this account"));
    expect(h.result.current.space).toBeNull();
  });
  it("does not revive a creation through an A-B-A transport swap", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.space.create ? receipt.promise : original(channel, args));
    const a: Transport = { kind: "a", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} };
    setTransport(a); const h = harness();
    await waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.space.create)).toBe(true));
    act(() => { setTransport({ ...a, kind: "b" }); setTransport(a); });
    await act(async () => { receipt.resolve({ success: true, data: space }); });
    expect(h.result.current.space).toBeNull();
    expect(h.result.current.error).toContain("connection changed");
  });
  it.each([
    ["missing", null], ["wrong account", { accountId: "other" }], ["wrong provider", { providerId: "claude_code" }], ["wrong mode", { mode: "chat" }],
  ])("rejects a routed run with %s identity instead of creating a new space", async (_name, patch) => {
    spaces = [space]; run = patch === null ? null : { ...run, ...patch };
    const h = harness("run");
    await waitFor(() => expect(h.result.current.error).toBe("Could not open this image run."));
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.space.create)).toBe(false);
  });
});
