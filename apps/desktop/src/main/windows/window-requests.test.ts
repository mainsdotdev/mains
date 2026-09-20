import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../../shared/ipc-kit/channels";

const mocks = vi.hoisted(() => ({
  reopenMainWindow: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock("./mainWindow", () => ({
  reopenMainWindow: mocks.reopenMainWindow,
}));

import { consumeWindowRequest, requestWindow } from "./window-requests";

const window = { isDestroyed: () => false, webContents: { send: mocks.send } };

afterEach(() => {
  consumeWindowRequest();
  vi.useRealTimers();
  mocks.reopenMainWindow.mockReset();
  mocks.send.mockReset();
});

describe("window requests", () => {
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
