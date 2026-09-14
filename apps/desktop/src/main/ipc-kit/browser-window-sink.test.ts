import { afterEach, describe, expect, it, vi } from "vitest";

// A fresh, controllable set of fake windows per test.
const { getAllWindows } = vi.hoisted(() => ({ getAllWindows: vi.fn(() => []) }));
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows } }));

import { clearEventSinks, emit } from "./event-bus";
import { registerBrowserWindowSink } from "./browser-window-sink";

function fakeWindow(destroyed = false) {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } };
}

describe("browserWindowSink", () => {
  afterEach(() => {
    clearEventSinks();
    getAllWindows.mockReset();
    getAllWindows.mockReturnValue([]);
  });

  it("broadcasts emitted events to every live window", () => {
    const a = fakeWindow();
    const b = fakeWindow();
    getAllWindows.mockReturnValue([a, b] as never);
    registerBrowserWindowSink();

    emit("runs:statusChanged", { runId: "r1" });

    expect(a.webContents.send).toHaveBeenCalledWith("runs:statusChanged", {
      runId: "r1",
    });
    expect(b.webContents.send).toHaveBeenCalledWith("runs:statusChanged", {
      runId: "r1",
    });
  });

  it("skips destroyed windows", () => {
    const live = fakeWindow(false);
    const dead = fakeWindow(true);
    getAllWindows.mockReturnValue([live, dead] as never);
    registerBrowserWindowSink();

    emit("x:y", 1);

    expect(live.webContents.send).toHaveBeenCalledOnce();
    expect(dead.webContents.send).not.toHaveBeenCalled();
  });

  it("re-registering does not double-send (singleton sink)", () => {
    const win = fakeWindow();
    getAllWindows.mockReturnValue([win] as never);
    registerBrowserWindowSink();
    registerBrowserWindowSink();

    emit("x:y", 1);

    expect(win.webContents.send).toHaveBeenCalledOnce();
  });

  it("stops broadcasting after unregister", () => {
    const win = fakeWindow();
    getAllWindows.mockReturnValue([win] as never);
    const off = registerBrowserWindowSink();
    off();

    emit("x:y", 1);

    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
