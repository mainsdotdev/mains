import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { killProviderProcess, spawnProvider } from "./provider-process";
import { providerLoginCommand } from "../providers.utils";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("provider processes", () => {
  it("preserves literal argv, including spaces, quotes and shell syntax", async () => {
    const args = ["Test User", "Türkçe", "a&b", "a|b", 'say "hello"', "100%", "$(never-run)"];
    const child = spawnProvider(process.execPath, ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", ...args], {
      stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
    });
    let output = "";
    child.stdout!.on("data", chunk => { output += chunk.toString(); });
    const [code] = await once(child, "close");
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual(args);
  });

  it.runIf(process.platform === "win32")("launches a Windows .cmd shim in a directory with spaces", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "Mains Türkçe Test User "));
    directories.push(directory);
    const script = path.join(directory, "cli.cjs");
    const shim = path.join(directory, "agent.cmd");
    fs.writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)));\n");
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0cli.cjs" %*\r\n`);
    const args = ["app-server", "Test User", "Türkçe", "a&b"];
    const child = spawnProvider(shim, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 5000 });
    let output = "";
    child.stdout!.on("data", chunk => { output += chunk.toString(); });
    const [code] = await once(child, "close");
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual(args);
  });

  it.runIf(process.platform === "win32")("executes generated login argv in real PowerShell", () => {
    const expected = ["Test User's Folder", "Türkçe", "a&b"];
    const command = providerLoginCommand(process.execPath,
      ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", ...expected]);
    const utf8Command = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${command}`;
    const output = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", utf8Command],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    expect(JSON.parse(output.trim())).toEqual(expected);
  });

  it.runIf(process.platform === "win32")("stops the Windows wrapper and its descendant process", async () => {
    const script = `const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      console.log(child.pid); setInterval(()=>{},1000);`;
    const child = spawnProvider(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let descendant: number | undefined;
    try {
      const [chunk] = await once(child.stdout!, "data");
      descendant = Number(chunk.toString().trim());
      expect(descendant).toBeGreaterThan(0);
      const closed = once(child, "close");
      killProviderProcess(child);
      await closed;
      expect(() => process.kill(descendant!, 0)).toThrow();
    } finally {
      if (child.exitCode === null) killProviderProcess(child);
      if (descendant) { try { process.kill(descendant); } catch { /* already stopped */ } }
    }
  }, 10_000);
});
