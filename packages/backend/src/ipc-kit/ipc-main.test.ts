import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const { handle, removeHandler } = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));
import { configureIpcMainAdapter, ipcMain } from "./ipc-main";
import { clearHandlers, hasHandler, invokeHandler } from "./handler-registry";

describe("ipcMain shim", () => {
  const restore = configureIpcMainAdapter({ handle, removeHandler });

  afterAll(() => restore());

  afterEach(() => {
    clearHandlers();
    handle.mockClear();
    removeHandler.mockClear();
  });

  it("handle registers into the registry AND binds the real ipcMain", () => {
    const handler = vi.fn();
    ipcMain.handle("entities:getAll", handler);

    expect(hasHandler("entities:getAll")).toBe(true);
    expect(handle).toHaveBeenCalledWith("entities:getAll", handler);
  });

  it("a registry-invoked handler runs with ctx + args", async () => {
    ipcMain.handle("entities:getById", async (_ctx, id) => ({
      success: true,
      data: `got ${id}`,
    }));

    const result = await invokeHandler("entities:getById", ["e1"], {
      clientId: "c1",
    });

    expect(result).toEqual({ success: true, data: "got e1" });
  });

  it("removeHandler unregisters AND calls the real ipcMain", () => {
    ipcMain.handle("a:b", vi.fn());
    ipcMain.removeHandler("a:b");

    expect(hasHandler("a:b")).toBe(false);
    expect(removeHandler).toHaveBeenCalledWith("a:b");
  });
});
