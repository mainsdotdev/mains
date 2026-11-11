vi.mock("../bridge", () => ({ assertOwnedRecord: vi.fn() }));
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPty } = vi.hoisted(() => {
  const mockPty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
  return { mockPty };
});

vi.mock("node-pty", () => ({
  default: {
    spawn: vi.fn().mockReturnValue(mockPty),
  },
  spawn: vi.fn().mockReturnValue(mockPty),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { terminalService } from "./terminal.service";
import * as pty from "node-pty";
import os from "os";
import path from "path";

describe("terminalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset internal map by destroying all
    terminalService.destroyAll();
    vi.clearAllMocks(); // clear the destroy-related calls
  });

  describe("create", () => {
    it("cleans up the native child when listener installation fails", () => {
      mockPty.onExit.mockImplementationOnce(() => { throw new Error("Exit listener unavailable"); });
      expect(() => terminalService.create("t", "/tmp", vi.fn(), { workspaceId: "w" })).toThrow(/Exit listener/);
      expect(mockPty.kill).toHaveBeenCalledOnce();
      expect(terminalService.list()).toEqual([]);
      expect(() => terminalService.attach("t", vi.fn())).toThrow(/no longer exists/);
    });

    it("keeps a native exit authoritative when listener installation then throws", () => {
      mockPty.onExit.mockImplementationOnce((callback: (event: { exitCode: number }) => void) => {
        callback({ exitCode: 0 }); throw new Error("Listener registration failed after exit");
      });
      expect(() => terminalService.create("t", "/tmp", vi.fn())).toThrow(/Listener registration/);
      expect(mockPty.kill).not.toHaveBeenCalled();
      expect(() => terminalService.attach("t", vi.fn())).toThrow(/no longer/);
    });
    it("spawns a pty process with correct options", () => {
      const onData = vi.fn();
      terminalService.create("t1", "/home/user", onData);

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String), // shell
        [],
        expect.objectContaining({
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: "/home/user",
          env: expect.any(Object),
        }),
      );
    });

    it("uses the backend home directory for a workspace-less terminal", () => {
      terminalService.create("auth", undefined, vi.fn());

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({ cwd: path.resolve(os.homedir()) }),
      );
    });

    it("registers onData callback", () => {
      const onData = vi.fn();
      terminalService.create("t1", "/tmp", onData);

      expect(mockPty.onData).toHaveBeenCalled();
      // Simulate data event
      const dataHandler = mockPty.onData.mock.calls[0][0];
      dataHandler("hello");
      expect(onData).toHaveBeenCalledWith("t1", "hello", 1);
    });

    it("reattaches an existing instance without killing its server", () => {
      const onData = vi.fn();
      terminalService.create("t1", "/tmp", onData);
      terminalService.create("t1", "/tmp", onData);

      expect(mockPty.kill).not.toHaveBeenCalled();
      expect(pty.spawn).toHaveBeenCalledTimes(1);
    });

    it("filters sensitive env vars", () => {
      // Set some env vars to test filtering
      const originalEnv = { ...process.env };
      process.env.GITHUB_TOKEN = "secret";
      process.env.LINEAR_KEY = "secret2";
      process.env.SAFE_VAR = "ok";

      terminalService.create("t1", "/tmp", vi.fn());

      const spawnCall = vi.mocked(pty.spawn).mock.calls[0];
      const env = spawnCall[2]?.env as Record<string, string>;
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.LINEAR_KEY).toBeUndefined();
      expect(env.SAFE_VAR).toBe("ok");

      // Restore
      process.env = originalEnv;
    });
  });

  describe("persistent sessions", () => {
    it("settles native exit once and ignores callbacks after the process is terminal", () => {
      const exit = vi.fn();
      terminalService.create("t", "/tmp", vi.fn(), { workspaceId: "w" }, exit);
      const data = mockPty.onData.mock.calls[0][0], ended = mockPty.onExit.mock.calls[0][0];
      data("finished"); ended({ exitCode: 0 }); data("late"); ended({ exitCode: 2 });
      expect(exit).toHaveBeenCalledOnce();
      expect(terminalService.attach("t", vi.fn())).toMatchObject({ data: "finished", session: { status: "exited", exitCode: 0 } });
    });

    it("releases both native listeners even when one disposal fails", () => {
      const logging = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitDispose = vi.fn();
      mockPty.onData.mockReturnValueOnce({ dispose: () => { throw new Error("Listener unavailable"); } });
      mockPty.onExit.mockReturnValueOnce({ dispose: exitDispose });
      try {
        terminalService.create("t", "/tmp", vi.fn());
        expect(() => terminalService.destroy("t")).not.toThrow();
        expect(mockPty.kill).toHaveBeenCalledOnce(); expect(exitDispose).toHaveBeenCalledOnce();
        expect(() => terminalService.attach("t", vi.fn())).toThrow(/no longer/);
      } finally { logging.mockRestore(); }
    });
    it("keeps independent tabs and workspaces discoverable", () => {
      terminalService.create("a1", "/tmp", vi.fn(), { workspaceId: "a", workspaceName: "Website" });
      terminalService.create("a2", "/tmp", vi.fn(), { workspaceId: "a" });
      terminalService.create("b1", "/tmp", vi.fn(), { workspaceId: "b" });
      terminalService.create("auth", undefined, vi.fn());
      expect(terminalService.list().map((session) => [session.id, session.title, session.workspaceId])).toEqual([
        ["a1", "Terminal 1", "a"], ["a2", "Terminal 2", "a"], ["b1", "Terminal 1", "b"],
      ]);
      terminalService.destroy("a1");
      expect(terminalService.list().map((session) => session.id)).toEqual(["a2", "b1"]);
      expect(mockPty.kill).toHaveBeenCalledOnce();
    });

    it("replays hidden output once and routes new output to the attached view", () => {
      const firstView = vi.fn();
      terminalService.create("t", "/tmp", firstView);
      const data = mockPty.onData.mock.calls[0][0];
      data("server ready\r\n");
      data("request received\r\n");
      const nextView = vi.fn();
      expect(terminalService.attach("t", nextView)).toMatchObject({ data: "server ready\r\nrequest received\r\n", sequence: 2 });
      data("response\r\n");
      expect(nextView).toHaveBeenCalledWith("t", "response\r\n", 3);
      expect(firstView).toHaveBeenCalledTimes(2);
      expect(mockPty.kill).not.toHaveBeenCalled();
    });

    it("bounds background output and preserves its latest sequence", () => {
      terminalService.create("t", "/tmp", vi.fn());
      const data = mockPty.onData.mock.calls[0][0];
      for (let index = 0; index < 10; index++) data("x".repeat(20_000));
      data("latest");
      const result = terminalService.attach("t", vi.fn());
      expect(result.data.length).toBeLessThanOrEqual(128 * 1024);
      expect(result.data.endsWith("latest")).toBe(true);
      expect(result.sequence).toBe(11);
    });

    it("retains exited output without resurrecting or killing an exited process", () => {
      const exit = vi.fn();
      terminalService.create("t", "/tmp", vi.fn(), { workspaceId: "a" }, exit);
      mockPty.onData.mock.calls[0][0]("finished");
      mockPty.onExit.mock.calls[0][0]({ exitCode: 2 });
      expect(exit).toHaveBeenCalledWith("t", 2);
      expect(terminalService.list()[0]).toMatchObject({ status: "exited", exitCode: 2 });
      expect(terminalService.attach("t", vi.fn()).data).toBe("finished");
      terminalService.write("t", "ignored");
      terminalService.create("t", "/tmp", vi.fn());
      expect(mockPty.write).not.toHaveBeenCalled();
      expect(pty.spawn).toHaveBeenCalledTimes(1);
      terminalService.destroy("t");
      expect(mockPty.kill).not.toHaveBeenCalled();
    });

    it("does not recreate a stopped terminal when a stale view tries to attach", () => {
      terminalService.create("t", "/tmp", vi.fn());
      terminalService.destroy("t");
      expect(() => terminalService.attach("t", vi.fn())).toThrow("Terminal no longer exists");
      expect(pty.spawn).toHaveBeenCalledOnce();
    });

    it("ignores late callbacks from a stopped process with a reused id", () => {
      terminalService.create("t", "/tmp", vi.fn());
      const oldData = mockPty.onData.mock.calls[0][0];
      const oldExit = mockPty.onExit.mock.calls[0][0];
      terminalService.destroy("t");
      terminalService.create("t", "/tmp", vi.fn());
      oldData("obsolete");
      oldExit({ exitCode: 1 });
      expect(terminalService.attach("t", vi.fn())).toMatchObject({ data: "", session: { status: "running" } });
    });

    it("rejects invalid ids and ignores hidden-pane resize dimensions", () => {
      expect(() => terminalService.create("", "/tmp", vi.fn())).toThrow("Invalid terminal id");
      terminalService.create("t", "/tmp", vi.fn());
      for (const [cols, rows] of [[0, 0], [NaN, 24], [80, Infinity], [80, -1]]) terminalService.resize("t", cols, rows);
      expect(mockPty.resize).not.toHaveBeenCalled();
    });
  });

  describe("write", () => {
    it("acknowledges a retried one-shot input without writing it into the PTY again", () => {
      const { session } = terminalService.create("auth", "/tmp", vi.fn());
      const options = { instanceId: session.instanceId, commandId: "login" };
      terminalService.write("auth", "codex login\r", options);
      terminalService.write("auth", "codex login\r", options);
      expect(mockPty.write).toHaveBeenCalledOnce();
      mockPty.onExit.mock.calls[0][0]({ exitCode: 0 });
      expect(() => terminalService.write("auth", "codex login\r", options)).not.toThrow();
      expect(() => terminalService.write("auth", "different\r", options)).toThrow(/identity/);
      expect(mockPty.write).toHaveBeenCalledOnce();
    });

    it("retains uncertainty after native input throws and refuses automatic replay", () => {
      const { session } = terminalService.create("auth", "/tmp", vi.fn());
      const options = { instanceId: session.instanceId, commandId: "login" };
      mockPty.write.mockImplementationOnce(() => { throw new Error("Native pipe failed after accepting bytes"); });
      expect(() => terminalService.write("auth", "codex login\r", options)).toThrow(/Native pipe/);
      expect(() => terminalService.write("auth", "codex login\r", options)).toThrow(/unconfirmed/);
      expect(mockPty.write).toHaveBeenCalledOnce();
    });

    it("does not acknowledge one-shot input for a missing or exited process", () => {
      expect(() => terminalService.write("missing", "codex login\r", { commandId: "login" })).toThrow(/no longer/);
      terminalService.create("auth", "/tmp", vi.fn());
      mockPty.onExit.mock.calls[0][0]({ exitCode: 0 });
      expect(() => terminalService.write("auth", "codex login\r", { commandId: "login" })).toThrow(/no longer/);
      expect(mockPty.write).not.toHaveBeenCalled();
    });
    it("refuses input for a replaced native instance even when its terminal id is reused", () => {
      const original = terminalService.create("t", "/tmp", vi.fn());
      terminalService.destroy("t");
      terminalService.create("t", "/tmp", vi.fn());
      mockPty.write.mockClear();
      expect(() => terminalService.write("t", "claude auth login\r", { instanceId: original.session.instanceId ?? "old-instance" })).toThrow(/changed|no longer/);
      expect(mockPty.write).not.toHaveBeenCalled();
    });
    it("writes data to existing instance", () => {
      terminalService.create("t1", "/tmp", vi.fn());
      terminalService.write("t1", "ls\n");

      expect(mockPty.write).toHaveBeenCalledWith("ls\n");
    });

    it("does nothing for unknown instance", () => {
      terminalService.write("unknown", "data");
      expect(mockPty.write).not.toHaveBeenCalled();
    });
  });

  describe("resize", () => {
    it("resizes existing instance", () => {
      terminalService.create("t1", "/tmp", vi.fn());
      terminalService.resize("t1", 120, 40);

      expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
    });

    it("does nothing for unknown instance", () => {
      terminalService.resize("unknown", 120, 40);
      expect(mockPty.resize).not.toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("ignores stale resize and destroy calls for a previous native incarnation", () => {
      const original = terminalService.create("t", "/tmp", vi.fn());
      terminalService.destroy("t");
      const current = terminalService.create("t", "/tmp", vi.fn());
      expect(current.session.instanceId).not.toBe(original.session.instanceId);
      mockPty.kill.mockClear();
      terminalService.resize("t", 120, 40, original.session.instanceId);
      terminalService.destroy("t", original.session.instanceId);
      expect(mockPty.resize).not.toHaveBeenCalled(); expect(mockPty.kill).not.toHaveBeenCalled();
      expect(terminalService.attach("t", vi.fn()).session.instanceId).toBe(current.session.instanceId);
    });
    it("retains a terminal when native stopping fails and permits a later stop", () => {
      terminalService.create("t", "/tmp", vi.fn(), { workspaceId: "w" });
      mockPty.kill.mockImplementationOnce(() => { throw new Error("Could not stop process"); });
      expect(() => terminalService.destroy("t")).toThrow("Could not stop process");
      expect(terminalService.list().map((session) => session.id)).toEqual(["t"]);
      expect(() => terminalService.destroy("t")).not.toThrow();
      expect(terminalService.list()).toEqual([]);
    });
    it("kills process and disposes listener", () => {
      const disposeFn = vi.fn();
      mockPty.onData.mockReturnValue({ dispose: disposeFn });

      terminalService.create("t1", "/tmp", vi.fn());
      terminalService.destroy("t1");

      expect(disposeFn).toHaveBeenCalled();
      expect(mockPty.kill).toHaveBeenCalled();
    });

    it("does nothing for unknown instance", () => {
      terminalService.destroy("unknown");
      expect(mockPty.kill).not.toHaveBeenCalled();
    });

    it("removes instance from map (write after destroy is no-op)", () => {
      terminalService.create("t1", "/tmp", vi.fn());
      terminalService.destroy("t1");
      vi.clearAllMocks();

      terminalService.write("t1", "data");
      expect(mockPty.write).not.toHaveBeenCalled();
    });
  });

  describe("destroyAll", () => {
    it("attempts every terminal when one native stop fails and keeps that one retryable", () => {
      terminalService.create("t1", "/tmp", vi.fn(), { workspaceId: "w" });
      terminalService.create("t2", "/tmp", vi.fn(), { workspaceId: "w" });
      mockPty.kill.mockImplementationOnce(() => { throw new Error("Could not stop first process"); });
      expect(() => terminalService.destroyAll()).toThrow();
      expect(mockPty.kill).toHaveBeenCalledTimes(2);
      expect(terminalService.list().map((session) => session.id)).toEqual(["t1"]);
      expect(() => terminalService.destroyAll()).not.toThrow();
    });
    it("destroys all instances", () => {
      terminalService.create("t1", "/tmp", vi.fn());
      terminalService.create("t2", "/tmp", vi.fn());
      vi.clearAllMocks();

      terminalService.destroyAll();

      expect(mockPty.kill).toHaveBeenCalledTimes(2);
    });

    it("handles empty map gracefully", () => {
      expect(() => terminalService.destroyAll()).not.toThrow();
    });
  });
});
