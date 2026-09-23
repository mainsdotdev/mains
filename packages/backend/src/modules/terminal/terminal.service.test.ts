import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPty } = vi.hoisted(() => {
  const mockPty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
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
      expect(onData).toHaveBeenCalledWith("t1", "hello");
    });

    it("destroys existing instance before creating new one", () => {
      const onData = vi.fn();
      terminalService.create("t1", "/tmp", onData);
      terminalService.create("t1", "/tmp", onData);

      // First instance should have been killed
      expect(mockPty.kill).toHaveBeenCalledTimes(1);
      // spawn called twice
      expect(pty.spawn).toHaveBeenCalledTimes(2);
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

  describe("write", () => {
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
