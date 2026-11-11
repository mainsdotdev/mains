// @vitest-environment jsdom
import { type ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import { ActiveSpaceOverrideProvider } from "@/hooks/use-active-space";
import { getTransport, resetTransport, setTransport, type Transport } from "@/lib/transport";
import { toastStore } from "@/components/ui";
import { useRunOperations } from "@/features/workspace/hooks/use-run-operations";
import type { Space } from "@/lib/redux/api/spaceApi";
import { persistConversationSettings } from "@/features/workspace/lib/conversation-settings-writer";

const space = { id: "codex", accountId: "account", providerId: "codex", mode: "work" } as Space;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const invoke = vi.fn();
const stores: ReturnType<typeof makeStore>[] = [];
function makeStore() { return configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer }, middleware: (defaults) => defaults().concat(baseApi.middleware) }); }
function harness(current: (accountId?: string) => boolean) {
  const store = makeStore(); stores.push(store); const register = vi.fn(async (id: string) => id);
  return { register, ...renderHook(() => useRunOperations({ registerNewRun: register, loadRunDetails: vi.fn(), onRunUpdated: vi.fn(), operationIsCurrent: current }), {
    wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}><ActiveSpaceOverrideProvider space={space}>{children}</ActiveSpaceOverrideProvider></Provider>,
  }) };
}
beforeEach(() => {
  invoke.mockImplementation(async (channel) => {
    if (channel === CHANNELS.account.get) return { success: true, data: { id: "account" } };
    if (channel === CHANNELS.runs.execute) return { success: true, data: { runId: "image-run" } };
    if (channel === CHANNELS.space.getAll) return { success: true, data: [space] };
    if (channel === CHANNELS.appSettings.get) return { success: true, data: { activeSpaceId: "codex" } };
    throw new Error("Unexpected channel " + channel);
  });
  setTransport({ kind: "test", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} } as Transport);
});
afterEach(() => { cleanup(); for (const store of stores.splice(0)) store.dispatch(baseApi.util.resetApiState()); resetTransport(); toastStore.dismissAll(); vi.clearAllMocks(); });

describe("image run delivery scope", () => {
  it("does not submit when fresh account lookup belongs to a different account", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.account.get
      ? Promise.resolve({ success: true, data: { id: "other-account" } }) : original(channel, args));
    const h = harness((accountId) => !accountId || accountId === "account");
    await act(async () => { expect(await h.result.current.executeRun("Draw", undefined, "codex")).toBeNull(); });
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.runs.execute)).toBe(false);
    expect(h.result.current.isLoading).toBe(false);
  });
  it("keeps the Codex Work identity and collection on a current native submission", async () => {
    const h = harness(() => true);
    await act(async () => { expect(await h.result.current.executeRun("$imagegen Mountain", undefined, "codex", "model", undefined, [], "collection")).toBe("image-run"); });
    expect(invoke).toHaveBeenCalledWith(CHANNELS.runs.execute, [expect.objectContaining({ accountId: "account", spaceId: "codex", mode: "work", providerId: "codex", collectionId: "collection", goal: "$imagegen Mountain" })]);
  });
  it("does not register an accepted run after its owner retired", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.runs.execute ? receipt.promise : original(channel, args));
    let current = true; const h = harness(() => current);
    let request!: Promise<string | null>;
    act(() => { request = h.result.current.executeRun("Draw", undefined, "codex"); });
    await waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.runs.execute)).toBe(true));
    current = false;
    await act(async () => { receipt.resolve({ success: true, data: { runId: "late-run" } }); expect(await request).toBeNull(); });
    expect(h.register).not.toHaveBeenCalled(); expect(toastStore.getSnapshot()).toHaveLength(0);
  });
  it("does not continue after its owner retires while waiting for saved settings", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.runs.update ? receipt.promise : original(channel, args));
    const writing = persistConversationSettings(getTransport(), "image-run", { model: "new-model", config: {} });
    await waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.runs.update)).toBe(true));
    let current = true; const h = harness(() => current);
    let request!: Promise<boolean>;
    act(() => { request = h.result.current.continueRun("image-run", "Warmer sky"); });
    await waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.account.get)).toBe(true));
    current = false;
    await act(async () => { receipt.resolve({ success: true }); await writing; expect(await request).toBe(false); });
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.runs.continue)).toBe(false);
    expect(toastStore.getSnapshot()).toHaveLength(0);
  });
  it("does not read a replacement backend after an old continuation receipt", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.runs.continue ? receipt.promise : original(channel, args));
    let current = true; const h = harness(() => current);
    let request!: Promise<boolean>;
    act(() => { request = h.result.current.continueRun("image-run", "Warmer sky"); });
    await waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.runs.continue)).toBe(true));
    current = false;
    await act(async () => { receipt.resolve({ success: true }); expect(await request).toBe(false); });
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.runs.getById)).toBe(false);
  });
  it("does not start a run if its owner closes during account lookup", async () => {
    const receipt = deferred<any>(); const original = invoke.getMockImplementation()!;
    invoke.mockImplementation((channel, args) => channel === CHANNELS.account.get ? receipt.promise : original(channel, args));
    let current = true; const h = harness(() => current);
    let request!: Promise<string | null>;
    act(() => { request = h.result.current.executeRun("Draw a mountain", undefined, "codex"); });
    await waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.account.get)).toBe(true));
    current = false;
    await act(async () => { receipt.resolve({ success: true, data: { id: "account" } }); expect(await request).toBeNull(); });
    expect(invoke.mock.calls.some(([channel]) => channel === CHANNELS.runs.execute)).toBe(false);
    expect(h.register).not.toHaveBeenCalled();
  });
});
