import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { hasHandler, invokeHandler } from "../../ipc-kit/handler-registry";
import { registerTerminalIpc, unregisterTerminalIpc } from "./terminal.ipc";
import { terminalService } from "./terminal.service";

const mocks = vi.hoisted(() => ({ emit: vi.fn(), pty: {
  onData: vi.fn((_callback: (data: string) => void) => ({ dispose() {} })),
  onExit: vi.fn((_callback: (event: { exitCode: number }) => void) => ({ dispose() {} })),
  write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
} }));
vi.mock("node-pty", () => ({ spawn: () => mocks.pty }));
vi.mock("../../ipc-kit", () => ({ emit: mocks.emit }));

beforeEach(() => { terminalService.destroyAll(); vi.clearAllMocks(); registerTerminalIpc(); });
afterEach(() => { unregisterTerminalIpc(); terminalService.destroyAll(); });

describe("terminal IPC lifecycle", () => {
  it("reattaches a remote client without killing the shell and scopes its resumed stream", async () => {
    const created = await invokeHandler(CHANNELS.terminal.create, [{ id: "t", cwd: os.tmpdir(), workspaceId: "w", workspaceName: "Website" }], { clientId: "first" });
    expect(created).toMatchObject({ success: true, data: { session: { id: "t", workspaceId: "w" }, sequence: 0 } });
    const onData = mocks.pty.onData.mock.calls[0][0] as unknown as (data: string) => void;
    onData("ready");
    expect(mocks.emit).toHaveBeenCalledWith(CHANNELS.terminal.data, { id: "t", data: "ready", sequence: 1 }, { clientId: "first" });
    const attached = await invokeHandler(CHANNELS.terminal.attach, ["t"], { clientId: "second" });
    expect(attached).toMatchObject({ success: true, data: { data: "ready", sequence: 1 } });
    onData("response");
    expect(mocks.emit).toHaveBeenCalledWith(CHANNELS.terminal.data, { id: "t", data: "response", sequence: 2 }, { clientId: "second" });
    expect(mocks.pty.kill).not.toHaveBeenCalled();
  });

  it("publishes natural exits to the catalog and removes sessions only on stop", async () => {
    await invokeHandler(CHANNELS.terminal.create, [{ id: "t", workspaceId: "w" }], { clientId: "client" });
    const onExit = mocks.pty.onExit.mock.calls[0][0] as unknown as (event: { exitCode: number }) => void;
    mocks.emit.mockClear();
    onExit({ exitCode: 2 });
    expect(mocks.emit).toHaveBeenCalledWith(CHANNELS.terminal.exit, { id: "t", exitCode: 2 }, { clientId: "client" });
    expect(mocks.emit).toHaveBeenCalledWith(CHANNELS.terminal.changed, {});
    expect(await invokeHandler(CHANNELS.terminal.list, [])).toMatchObject({ success: true, data: [{ id: "t", status: "exited", exitCode: 2 }] });
    await invokeHandler(CHANNELS.terminal.destroy, ["t"]);
    expect(await invokeHandler(CHANNELS.terminal.list, [])).toMatchObject({ success: true, data: [] });
    expect(await invokeHandler(CHANNELS.terminal.attach, ["t"])).toMatchObject({ success: false, error: expect.stringContaining("no longer exists") });
  });

  it("unregisters all terminal commands on shutdown", () => {
    unregisterTerminalIpc();
    for (const channel of [CHANNELS.terminal.create, CHANNELS.terminal.attach, CHANNELS.terminal.list,
      CHANNELS.terminal.write, CHANNELS.terminal.resize, CHANNELS.terminal.destroy, CHANNELS.terminal.destroyIdle]) expect(hasHandler(channel)).toBe(false);
  });

  it("exposes idle cleanup and only publishes a catalog change when tabs were removed", async () => {
    const cleanup = vi.spyOn(terminalService, "destroyIdle");
    try {
      cleanup.mockResolvedValue([]);
      mocks.emit.mockClear();
      expect(await invokeHandler(CHANNELS.terminal.destroyIdle, ["w"])).toEqual({ success: true, data: [] });
      expect(mocks.emit).not.toHaveBeenCalled();
      cleanup.mockResolvedValue(["idle"]);
      expect(await invokeHandler(CHANNELS.terminal.destroyIdle, ["w"])).toEqual({ success: true, data: ["idle"] });
      expect(cleanup).toHaveBeenCalledWith("w");
      expect(mocks.emit).toHaveBeenCalledWith(CHANNELS.terminal.changed, {});
    } finally { cleanup.mockRestore(); }
  });
});
