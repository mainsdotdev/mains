import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiType } from "./index";
import { CHANNELS } from "@mains/contracts/channels";

const native = vi.hoisted(() => ({
  api: undefined as ApiType | undefined,
  fullscreen: false,
  invoke: vi.fn(),
  listeners: new Set<(_event: unknown, fullscreen: boolean) => void>(),
}));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: ApiType) => { if (name === "api") native.api = value; } },
  ipcRenderer: {
    invoke: native.invoke,
    on: (_channel: string, listener: (_event: unknown, fullscreen: boolean) => void) => native.listeners.add(listener),
    removeListener: (_channel: string, listener: (_event: unknown, fullscreen: boolean) => void) => native.listeners.delete(listener),
  },
}));
import "./index";

beforeEach(() => {
  native.listeners.clear();
  native.fullscreen = false;
  native.invoke.mockReset().mockImplementation(async () => ({ success: true, data: native.fullscreen }));
});
function changeFullscreen(value: boolean) {
  native.fullscreen = value;
  for (const listener of native.listeners) listener({}, value);
}

describe("preload fullscreen subscription", () => {
  it.each([true, false])("delivers the current native fullscreen state %s without waiting for an event", async (fullscreen) => {
    native.fullscreen = fullscreen;
    native.invoke.mockImplementation(async () => {
      // Attach the listener before requesting the snapshot to avoid an event gap.
      expect(native.listeners.size).toBe(1);
      return { success: true, data: native.fullscreen };
    });
    const callback = vi.fn();
    const unsubscribe = native.api!.app.onFullscreenChange(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith(fullscreen));
    expect(native.invoke).toHaveBeenCalledWith(CHANNELS.app.getFullscreen);
    unsubscribe();
  });

  it("recovers fullscreen state for a new subscriber after the previous one unmounts", async () => {
    const first = vi.fn();
    const unsubscribe = native.api!.app.onFullscreenChange(first);
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith(false));
    changeFullscreen(true);
    expect(first).toHaveBeenLastCalledWith(true);
    unsubscribe();
    expect(native.listeners.size).toBe(0);
    const second = vi.fn();
    const stop = native.api!.app.onFullscreenChange(second);
    await vi.waitFor(() => expect(second).toHaveBeenCalledExactlyOnceWith(true));
    stop();
  });

  it("tracks repeated enter and leave events after the initial snapshot", async () => {
    const callback = vi.fn();
    const unsubscribe = native.api!.app.onFullscreenChange(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false));
    callback.mockClear();
    for (const fullscreen of [true, false, true, false]) changeFullscreen(fullscreen);
    expect(callback.mock.calls).toEqual([[true], [false], [true], [false]]);
    unsubscribe();
  });

  it("does not let a delayed initial snapshot overwrite a newer native event", async () => {
    let finish!: (value: { success: true; data: boolean }) => void;
    const snapshot = new Promise((resolve) => { finish = resolve; });
    native.invoke.mockReturnValue(snapshot);
    const callback = vi.fn();
    const unsubscribe = native.api!.app.onFullscreenChange(callback);
    changeFullscreen(true);
    finish({ success: true, data: false });
    await snapshot;
    expect(callback).toHaveBeenCalledExactlyOnceWith(true);
    unsubscribe();
  });

  it("ignores a pending snapshot after unsubscribing", async () => {
    let finish!: (value: { success: true; data: boolean }) => void;
    const snapshot = new Promise((resolve) => { finish = resolve; });
    native.invoke.mockReturnValue(snapshot);
    const callback = vi.fn();
    const unsubscribe = native.api!.app.onFullscreenChange(callback);
    unsubscribe();
    finish({ success: true, data: true });
    await snapshot;
    expect(callback).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
  });

  it("keeps receiving native changes if reading the initial state fails", async () => {
    native.invoke.mockRejectedValue(new Error("Window is closing"));
    const callback = vi.fn();
    const unsubscribe = native.api!.app.onFullscreenChange(callback);
    await Promise.resolve();
    changeFullscreen(true);
    expect(callback).toHaveBeenCalledExactlyOnceWith(true);
    unsubscribe();
  });
});
