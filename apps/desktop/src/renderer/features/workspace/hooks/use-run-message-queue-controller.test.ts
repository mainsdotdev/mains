// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import runQueueReducer, { enqueueRunMessage, removeRunMessage } from "@/lib/redux/slices/runQueueSlice";

const mocks = vi.hoisted(() => {
  const invoke = vi.fn();
  return { getState: vi.fn(), subscribe: vi.fn(), invoke, dispatch: vi.fn(), pump: vi.fn(),
    transport: { kind: "ipc", status: () => "connected", invoke, subscribe: () => () => {}, onStatusChange: () => () => {} } };
});
vi.mock("@/lib/redux", () => ({ store: mocks }));
vi.mock("@/lib/transport", () => ({
  getTransport: () => mocks.transport,
  onTransportChange: () => () => {},
}));
vi.mock("../lib/run-message-queue", () => ({ runMessageQueue: { pump: mocks.pump, onStatus: vi.fn(), pauseBackend: vi.fn() } }));
import { useRunMessageQueueController } from "./use-run-message-queue-controller";

afterEach(() => vi.clearAllMocks());
describe("desktop queue visibility on paired devices", () => {
  it("publishes pending text and attachment names, then publishes their removal without sending the message twice", async () => {
    const store = configureStore({ reducer: { runQueue: runQueueReducer, backends: () => ({ activeBackendId: null }) } });
    mocks.getState.mockImplementation(store.getState); mocks.subscribe.mockImplementation(store.subscribe); mocks.dispatch.mockImplementation(store.dispatch);
    mocks.invoke.mockResolvedValue({ success: true, data: null });
    const hook = renderHook(() => useRunMessageQueueController());
    act(() => { store.dispatch(enqueueRunMessage({ ownerKey: '["local","run","run"]', backendId: "local", runId: "run", runStatus: "running",
      message: { id: "pending-one", text: "Queued on the computer", attachmentNames: ["notes.pdf"], contextItems: [], uploadOwnerKey: "private-files", status: "queued" } })); });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("runs:publishQueue", [expect.objectContaining({ runId: "run",
      messages: [expect.objectContaining({ id: "pending-one", text: "Queued on the computer", attachmentNames: ["notes.pdf"] })] })]));
    act(() => { store.dispatch(removeRunMessage({ ownerKey: '["local","run","run"]', id: "pending-one" })); });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("runs:publishQueue", [expect.objectContaining({ runId: "run", messages: [] })]));
    expect(JSON.stringify(mocks.invoke.mock.calls)).not.toContain("private-files");
    expect(mocks.invoke.mock.calls.every(([channel]) => channel === "runs:publishQueue")).toBe(true);
    hook.unmount();
  });
});
