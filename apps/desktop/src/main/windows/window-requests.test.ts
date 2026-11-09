import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { ipcMain } from "electron";

const mocks = vi.hoisted(() => ({
  reopenMainWindow: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock("./mainWindow", () => ({
  reopenMainWindow: mocks.reopenMainWindow,
  getMainWindow: () => window,
}));

import { consumeWindowRequest, requestWindow, registerWindowRequestIpc, unregisterWindowRequestIpc } from "./window-requests";

const window = { isDestroyed: () => false, webContents: { send: mocks.send } };

afterEach(() => {
  vi.restoreAllMocks();
  unregisterWindowRequestIpc();
  consumeWindowRequest();
  vi.useRealTimers();
  mocks.reopenMainWindow.mockReset();
  mocks.send.mockReset();
});

describe("window requests", () => {
  it("does not cancel a newer reentrant request when the older window open fails", () => {
    mocks.reopenMainWindow.mockImplementationOnce(() => {
      requestWindow({ kind: "navigate", path: "/pulse" });
      return null;
    }).mockReturnValue(window);
    requestWindow({ kind: "newChat" });
    expect(consumeWindowRequest()).toEqual({ kind: "navigate", path: "/pulse" });
  });
  it("retains an admitted request when the renderer ping fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.reopenMainWindow.mockReturnValue(window);
    mocks.send.mockImplementationOnce(() => { throw new Error("Renderer restarting"); });
    expect(() => requestWindow({ kind: "newChat" })).not.toThrow();
    expect(consumeWindowRequest()).toEqual({ kind: "newChat" });
  });
  it("rolls back a failed native window acquisition without throwing from the click handler", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.reopenMainWindow.mockImplementation(() => { throw new Error("Window unavailable"); });
    expect(() => requestWindow({ kind: "newChat" })).not.toThrow();
    expect(consumeWindowRequest()).toBeNull();
  });
  it("snapshots navigation input before the click caller can mutate it", () => {
    mocks.reopenMainWindow.mockReturnValue(window);
    const request = { kind: "navigate" as const, path: "/pulse" };
    requestWindow(request);
    request.path = "/settings";
    expect(consumeWindowRequest()).toEqual({ kind: "navigate", path: "/pulse" });
  });
  it("accepts the exact expiry boundary and drops a request beyond it", () => {
    vi.useFakeTimers();
    mocks.reopenMainWindow.mockReturnValue(window);
    requestWindow({ kind: "newChat" });
    vi.advanceTimersByTime(60000);
    expect(consumeWindowRequest()).toEqual({ kind: "newChat" });
    requestWindow({ kind: "newChat" });
    vi.advanceTimersByTime(60001);
    expect(consumeWindowRequest()).toBeNull();
  });
  it("lets only the main renderer consume a parked request through IPC", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.reopenMainWindow.mockReturnValue(window);
    requestWindow({ kind: "newChat" });
    registerWindowRequestIpc();
    const handler = vi.mocked(ipcMain.handle).mock.calls.at(-1)![1];
    await expect(handler({ sender: {} } as any)).resolves.toMatchObject({ success: false });
    await expect(handler({ sender: window.webContents } as any)).resolves.toEqual({ success: true, data: { kind: "newChat" } });
    expect(consumeWindowRequest()).toBeNull();
  });
  it("makes the request available if reopening the window consumes it synchronously", () => {
    let delivered: ReturnType<typeof consumeWindowRequest>;
    mocks.reopenMainWindow.mockImplementation(() => { delivered = consumeWindowRequest(); return window; });
    requestWindow({ kind: "newChat" });
    expect(delivered!).toEqual({ kind: "newChat" });
    expect(consumeWindowRequest()).toBeNull();
  });
  it("parks the request, pings the window, and hands it over once", () => {
    mocks.reopenMainWindow.mockReturnValue(window);

    requestWindow({ kind: "newChat" });

    expect(mocks.send).toHaveBeenCalledWith(CHANNELS.app.windowRequest);
    expect(consumeWindowRequest()).toEqual({ kind: "newChat" });
    expect(consumeWindowRequest()).toBeNull();
  });

  it("keeps only the newest request", () => {
    mocks.reopenMainWindow.mockReturnValue(window);
    requestWindow({ kind: "newChat" });
    requestWindow({ kind: "navigate", path: "/pulse" });
    expect(consumeWindowRequest()).toEqual({ kind: "navigate", path: "/pulse" });
  });

  it("drops a request nobody collected in time", () => {
    vi.useFakeTimers();
    mocks.reopenMainWindow.mockReturnValue(window);
    requestWindow({ kind: "newChat" });
    vi.advanceTimersByTime(61_000);
    expect(consumeWindowRequest()).toBeNull();
  });

  it("parks nothing in a process with no window to show (headless serve)", () => {
    mocks.reopenMainWindow.mockReturnValue(null);
    requestWindow({ kind: "newChat" });
    expect(consumeWindowRequest()).toBeNull();
  });
});
