import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { app, type BrowserWindow } from "electron";
import Database from "better-sqlite3";
import * as pty from "node-pty";
import { rgPath } from "@vscode/ripgrep";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { resolveClaudeRuntime, resolveCopilotRuntime } from "@mains/backend/modules/providers/providers.utils";
import { gitService } from "@mains/backend/modules/git";

const execFileAsync = promisify(execFile);

/** Runs inside the packaged Electron binary, with its real ABI, ASAR and preload. */
export async function runPackageSmoke(window: BrowserWindow): Promise<void> {
  assert(app.isPackaged, "The smoke check requires a packaged app");
  const database = new Database(":memory:");
  try { assert.equal((database.prepare("SELECT 42 AS value").get() as { value: number }).value, 42); }
  finally { database.close(); }

  const repo = await gitService.initRepo("Git Türkçe smoke", app.getPath("userData"));
  const cloneUrl = "https://mains-smoke.invalid/git-smoke.git";
  const gitConfig = path.join(app.getPath("userData"), "git-smoke.config");
  // Exercise the real clone command with a local fixture, without auth/network.
  fs.writeFileSync(gitConfig, `[url "${pathToFileURL(repo.rootPath).href}"]\n\tinsteadOf = ${cloneUrl}\n`);
  const previousGitConfig = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = gitConfig;
  try {
    const clone = await gitService.cloneRepo(cloneUrl, app.getPath("userData"));
    assert.equal(clone.defaultBranch, "main");
    assert(fs.existsSync(path.join(clone.clonedPath, "README.md")));
  } finally {
    if (previousGitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGitConfig;
  }

  await new Promise<void>((resolve, reject) => {
    const windows = process.platform === "win32";
    const terminal = pty.spawn(windows ? "powershell.exe" : "/bin/sh",
      windows ? ["-NoLogo", "-NoProfile", "-Command", "Write-Output 'MAINS_PTY_OK'"] : ["-c", "printf MAINS_PTY_OK"],
      { cwd: app.getPath("userData"), env: process.env as Record<string, string>, cols: 80, rows: 24 });
    let output = "";
    const timer = setTimeout(() => { terminal.kill(); reject(new Error("Packaged PTY timed out")); }, 15_000);
    terminal.onData(data => { output += data; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode === 0 && output.includes("MAINS_PTY_OK")) resolve();
      else reject(new Error(`Packaged PTY failed (${exitCode}): ${output}`));
    });
  });

  const claude = resolveClaudeRuntime();
  assert(claude?.source === "bundled", "Packaged Claude runtime is missing");
  assert((await execFileAsync(claude.path, ["--version"], { timeout: 20_000, windowsHide: true })).stdout.trim());
  const copilot = resolveCopilotRuntime();
  assert(copilot?.source === "bundled", "Packaged Copilot runtime is missing");
  const client = new CopilotClient({ connection: RuntimeConnection.forStdio({ path: copilot.path }),
    baseDirectory: path.join(app.getPath("userData"), "copilot-smoke"), useLoggedInUser: false, logLevel: "none" });
  try { await client.start(); assert((await client.getStatus()).version); await client.ping("package-smoke"); }
  finally { await client.forceStop(); }

  const searchFile = path.join(app.getPath("userData"), "Türkçe search.txt");
  fs.writeFileSync(searchFile, "MAINS_SEARCH_OK\n");
  assert((await execFileAsync(rgPath, ["MAINS_SEARCH_OK", searchFile], { timeout: 10_000, windowsHide: true })).stdout.includes("MAINS_SEARCH_OK"));
  const renderer = await window.webContents.executeJavaScript("({ os: window.api.platform.os, hasTransport: !!window.mainTransport, mounted: !!document.getElementById('root')?.childElementCount })");
  assert.equal(renderer.os, process.platform, "Packaged preload OS is missing");
  assert(renderer.hasTransport && renderer.mounted, "Packaged renderer failed to mount");
}
