import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWindowsWorkspaceApps, openWindowsWorkspaceInApp } from "./windows-open-with";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(), spawn: vi.fn(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe.skipIf(process.platform !== "win32")("native Windows workspace apps", () => {
  it("finds real built-in apps with an inherited PATH that has no editors", () => {
    vi.stubEnv("PATH", path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"));
    expect(getWindowsWorkspaceApps().map((item) => item.id)).toEqual(expect.arrayContaining(["explorer", "powershell"]));
  });

  it("starts real PowerShell at a workspace with Unicode and shell metacharacters", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mains Türkçe Okan's & $(literal)-"));
    const native = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() => child.emit("spawn"));
      return child as unknown as ReturnType<typeof spawn>;
    });
    try {
      await openWindowsWorkspaceInApp("powershell", folder);
      const [executable, args] = vi.mocked(spawn).mock.calls[0];
      // Run the production argv in a bounded, hidden subprocess. NoExit is
      // removed so this test does not leave a terminal open during VM testing.
      const boundedArgs = [...args as string[]].filter((arg) => arg !== "-NoExit");
      boundedArgs[boundedArgs.length - 1] += "; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Location).Path";
      const { stdout } = await promisify(native.execFile)(executable, boundedArgs, {
        cwd: folder, windowsHide: true, timeout: 20_000, encoding: "utf8",
      });
      // Windows TEMP may use an 8.3 user-directory alias; PowerShell expands it.
      expect(fs.realpathSync.native(stdout.trim()).toLowerCase())
        .toBe(fs.realpathSync.native(folder).toLowerCase());
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  }, 30_000);
});
