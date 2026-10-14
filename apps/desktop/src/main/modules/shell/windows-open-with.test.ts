import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { getWindowsWorkspaceApps, openWindowsWorkspaceInApp } from "./windows-open-with";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(), statSync: vi.fn(),
}));

const explorer = "C:\\Windows\\explorer.exe";
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const code = "C:\\Users\\Okan\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
const workspace = "C:\\Users\\Okan\\Masaüstü\\Okan's proje & $(literal)";
let files: Set<string>;

beforeEach(() => {
  vi.clearAllMocks();
  files = new Set([explorer, powershell]);
  vi.stubEnv("SystemRoot", "C:\\Windows");
  vi.stubEnv("LOCALAPPDATA", "C:\\Users\\Okan\\AppData\\Local");
  vi.stubEnv("ProgramFiles", "C:\\Program Files");
  vi.stubEnv("ProgramW6432", "C:\\Program Files");
  vi.stubEnv("ProgramFiles(x86)", "C:\\Program Files (x86)");
  vi.stubEnv("PATH", "C:\\Windows\\System32");
  vi.mocked(fs.statSync).mockImplementation((value) => {
    const filePath = String(value);
    if (files.has(filePath) || filePath === workspace) {
      return { isFile: () => files.has(filePath), isDirectory: () => filePath === workspace } as fs.Stats;
    }
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Windows workspace Open with", () => {
  it("offers Explorer and PowerShell even when no editor is installed", () => {
    expect(getWindowsWorkspaceApps().map((item) => item.id)).toEqual(["explorer", "powershell"]);
  });
  it("finds per-user editors missing from the app's stale PATH and omits absent editors", () => {
    files.add(code);
    expect(getWindowsWorkspaceApps().map((item) => item.id)).toEqual(["explorer", "powershell", "vscode"]);
  });
  it("finds system installs and portable editors whose bin directory is on PATH", () => {
    files.add("C:\\Program Files (x86)\\cursor\\Cursor.exe");
    files.add("D:\\Portable Code\\Code.exe");
    vi.stubEnv("PATH", '"D:\\Portable Code\\bin";relative-bin');
    const apps = getWindowsWorkspaceApps();
    expect(apps.find((item) => item.id === "vscode")?.path).toBe("D:\\Portable Code\\Code.exe");
    expect(apps.find((item) => item.id === "cursor")?.path).toBe("C:\\Program Files (x86)\\cursor\\Cursor.exe");
  });
  it("does not offer a directory named like an executable", () => {
    files.delete(explorer);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as fs.Stats);
    expect(getWindowsWorkspaceApps()).toEqual([]);
  });
  it.each(["vscode", "powershell", "explorer"])("launches %s with literal workspace arguments", async (appId) => {
    files.add(code);
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child as unknown as ReturnType<typeof spawn>;
    });
    await openWindowsWorkspaceInApp(appId, workspace);
    const [executable, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(executable).toBe({ vscode: code, powershell, explorer }[appId]);
    expect(args).toEqual(appId === "powershell"
      ? ["-NoLogo", "-NoExit", "-Command", "Set-Location -LiteralPath 'C:\\Users\\Okan\\Masaüstü\\Okan''s proje & $(literal)'"]
      : [workspace]);
    expect(options).toMatchObject({ cwd: workspace, detached: true, shell: false });
    expect(child.unref).toHaveBeenCalledOnce();
  });
  it.each(["relative", "C:\\Users\\Okan\\..\\other", "C:relative"])("rejects an invalid workspace path: %s", async (folder) => {
    vi.mocked(spawn).mockClear();
    await expect(openWindowsWorkspaceInApp("powershell", folder)).rejects.toThrow("Invalid workspace path");
    expect(spawn).not.toHaveBeenCalled();
  });
  it("rejects renderer-supplied executables and missing apps", async () => {
    await expect(openWindowsWorkspaceInApp("C:\\arbitrary.exe", workspace)).rejects.toThrow("Application is no longer installed");
    await expect(openWindowsWorkspaceInApp("cursor", workspace)).rejects.toThrow("Application is no longer installed");
  });
  it("reports launch errors instead of leaving an unhandled child error", async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("Access denied")));
      return child as ReturnType<typeof spawn>;
    });
    await expect(openWindowsWorkspaceInApp("powershell", workspace)).rejects.toThrow("Access denied");
  });
});
