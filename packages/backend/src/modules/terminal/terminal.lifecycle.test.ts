vi.mock("../bridge", () => ({ assertOwnedRecord: vi.fn() }));
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { terminalService } from "./terminal.service";

function responds(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get(`http://127.0.0.1:${port}`, (response) => { response.resume(); resolve(response.statusCode === 200); });
    request.on("error", () => resolve(false));
    request.setTimeout(500, () => { request.destroy(); resolve(false); });
  });
}
// The test scripts print each marker as one string: on a TTY, Node colors number arguments of
// console.log with ANSI codes, which would split "MAINS_TEST_SERVER <pid> <port>" for the regexes below.
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("No test port available")); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

// The terminal spawns zsh on macOS and Linux (terminal.service.ts), and these
// tests drive it with zsh builtins; CI's Ubuntu runner has no zsh installed.
const hasZsh = spawnSync("zsh", ["-c", "exit 0"]).status === 0;

describe.skipIf(!hasZsh)("real PTY server lifecycle", () => {
  it("closes three idle tabs on hide while a server and another workspace keep running", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "mains-terminal-idle-test-"));
    const serverFile = path.join(directory, "server.cjs");
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const serverId = `test-${crypto.randomUUID()}`;
    const idleIds = Array.from({ length: 3 }, () => `test-${crypto.randomUUID()}`);
    const otherId = `test-${crypto.randomUUID()}`;
    let output = "";
    let serverPid = 0;
    let port = 0;
    vi.stubEnv("ZDOTDIR", directory);
    try {
      writeFileSync(path.join(directory, ".zshenv"), "export MAINS_TEST_SHELL_CONFIG=loaded\n");
      writeFileSync(path.join(directory, ".zshrc"), "print MAINS_TEST_RC_$MAINS_TEST_SHELL_CONFIG\n");
      writeFileSync(serverFile, "const http = require('node:http'); const server = http.createServer((req, res) => res.end('alive')); server.listen(0, '127.0.0.1', () => console.log('MAINS_TEST_SERVER ' + process.pid + ' ' + server.address().port));\n");
      terminalService.create(serverId, directory, (_id, data) => { output += data; }, { workspaceId });
      await vi.waitFor(() => expect(output).toContain("MAINS_TEST_RC_loaded"), { timeout: 5000 });
      terminalService.write(serverId, `${quote(process.execPath)} ${quote(serverFile)}\r`);
      await vi.waitFor(() => {
        const match = output.match(/MAINS_TEST_SERVER (\d+) (\d+)/);
        expect(match).not.toBeNull();
        serverPid = Number(match![1]); port = Number(match![2]);
      }, { timeout: 8000, interval: 30 });
      for (const id of idleIds) terminalService.create(id, directory, () => {}, { workspaceId });
      terminalService.create(otherId, directory, () => {}, { workspaceId: "other-workspace" });
      await vi.waitFor(async () => {
        await terminalService.destroyIdle(workspaceId);
        expect(terminalService.list().filter((entry) => idleIds.includes(entry.id))).toHaveLength(0);
      }, { timeout: 8000, interval: 60 });
      expect(await responds(port)).toBe(true);
      expect(terminalService.list().some((entry) => entry.id === serverId)).toBe(true);
      expect(terminalService.list().some((entry) => entry.id === otherId)).toBe(true);
      expect(output).not.toContain("633;Mains;");
    } finally {
      for (const id of [serverId, ...idleIds, otherId]) terminalService.destroy(id);
      if (serverPid) { try { process.kill(serverPid, "SIGTERM"); } catch { /* already exited */ } }
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 20000);

  it("preserves a shell builtin waiting for input and a background job without a server port", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "mains-terminal-idle-test-"));
    const busyFile = path.join(directory, "background.cjs");
    const id = `test-${crypto.randomUUID()}`;
    let output = "";
    let childPid = 0;
    vi.stubEnv("ZDOTDIR", directory);
    try {
      writeFileSync(busyFile, "console.log('MAINS_TEST_BACKGROUND ' + process.pid); setInterval(() => {}, 1000);\n");
      terminalService.create(id, directory, (_id, data) => { output += data; }, { workspaceId: id });
      terminalService.write(id, "print MAINS_TEST_READ_READY; read _mains_answer; print MAINS_TEST_READ_DONE\r");
      await vi.waitFor(() => expect(output).toMatch(/MAINS_TEST_READ_READY\r?\n/), { timeout: 8000, interval: 30 });
      expect(await terminalService.destroyIdle(id)).toEqual([]);
      expect(terminalService.list().some((entry) => entry.id === id)).toBe(true);
      terminalService.write(id, "answer\r");
      await vi.waitFor(() => expect(output).toMatch(/MAINS_TEST_READ_DONE\r?\n/), { timeout: 5000 });
      terminalService.write(id, `${quote(process.execPath)} ${quote(busyFile)} &\r`);
      await vi.waitFor(() => {
        const match = output.match(/MAINS_TEST_BACKGROUND (\d+)/);
        expect(match).not.toBeNull(); childPid = Number(match![1]);
      }, { timeout: 8000, interval: 30 });
      await terminalService.refreshServers();
      expect(terminalService.list().find((entry) => entry.id === id)?.servers).toEqual([]);
      expect(await terminalService.destroyIdle(id)).toEqual([]);
      expect(terminalService.list().some((entry) => entry.id === id)).toBe(true);
    } finally {
      terminalService.destroy(id);
      if (childPid) { try { process.kill(childPid, "SIGTERM"); } catch { /* already exited */ } }
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 20000);

  it("keeps a listener opened directly by a shell builtin even without child processes", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "mains-terminal-idle-test-"));
    const id = `test-${crypto.randomUUID()}`;
    let output = "";
    vi.stubEnv("ZDOTDIR", directory);
    try {
      const port = await availablePort();
      terminalService.create(id, directory, (_id, data) => { output += data; }, { workspaceId: id });
      const submittedAt = Date.now();
      terminalService.write(id, `zmodload zsh/net/tcp && ztcp -l ${port} && print MAINS_TEST_SHELL_SOCKET_READY\r`);
      await vi.waitFor(() => expect(output).toMatch(/(?:^|\r?\n)MAINS_TEST_SHELL_SOCKET_READY\r?\n/), { timeout: 5000 });
      await terminalService.refreshServers();
      expect(terminalService.list().find((entry) => entry.id === id)?.servers?.length).toBeGreaterThan(0);
      // Exercise the socket inspection, after the recent-input guard expires.
      await vi.waitFor(() => expect(Date.now() - submittedAt).toBeGreaterThan(300), { timeout: 3000 });
      expect(await terminalService.destroyIdle(id)).toEqual([]);
      expect(terminalService.list().some((entry) => entry.id === id)).toBe(true);
    } finally {
      terminalService.destroy(id);
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 10000);

  it("keeps a server alive across detach/reattach and stops it only on explicit destruction", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "mains-terminal-test-"));
    const file = path.join(directory, "server.cjs");
    const id = `test-${crypto.randomUUID()}`;
    const otherId = `test-${crypto.randomUUID()}`;
    let output = "";
    let serverPid: number | undefined;
    let port = 0;
    vi.stubEnv("ZDOTDIR", directory);
    try {
      writeFileSync(file, `const http = require('node:http');\nconst server = http.createServer((req, res) => res.end('alive'));\nserver.listen(0, '127.0.0.1', () => console.log('MAINS_TEST_SERVER ' + process.pid + ' ' + server.address().port));\n`);
      terminalService.create(id, directory, (_id, data) => { output += data; }, { workspaceId: "test-a" });
      await terminalService.refreshServers();
      expect(terminalService.list().find((entry) => entry.id === id)?.servers).toEqual([]);
      terminalService.write(id, `${quote(process.execPath)} ${quote(file)}\r`);
      await vi.waitFor(() => {
        const match = output.match(/MAINS_TEST_SERVER (\d+) (\d+)/);
        expect(match).not.toBeNull();
        serverPid = Number(match![1]);
        port = Number(match![2]);
      }, { timeout: 8000, interval: 30 });
      expect(await responds(port)).toBe(true);
      terminalService.create(otherId, directory, () => {}, { workspaceId: "test-b" });
      await terminalService.refreshServers();
      expect(terminalService.list().find((entry) => entry.id === id)?.servers).toEqual([
        expect.objectContaining({ pid: serverPid, port }),
      ]);
      expect(terminalService.list().find((entry) => entry.id === otherId)?.servers).toEqual([]);
      const replay = terminalService.attach(id, () => {});
      expect(replay.data).toContain("MAINS_TEST_SERVER");
      expect(await responds(port)).toBe(true);
      terminalService.destroy(id);
      await vi.waitFor(async () => expect(await responds(port)).toBe(false), { timeout: 3000, interval: 30 });
      expect(terminalService.list().some((session) => session.id === otherId && session.status === "running")).toBe(true);
    } finally {
      terminalService.destroy(id);
      terminalService.destroy(otherId);
      // Only the test's own child is eligible for this fallback cleanup.
      if (serverPid) { try { process.kill(serverPid, "SIGTERM"); } catch { /* already exited */ } }
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 15000);

  it("does not count a busy command as a server and clears ports after Ctrl+C without closing the shell", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "mains-terminal-test-"));
    const busyFile = path.join(directory, "busy.cjs");
    const serverFile = path.join(directory, "server.cjs");
    const id = `test-${crypto.randomUUID()}`;
    let output = "";
    let port = 0;
    const childPids: number[] = [];
    vi.stubEnv("ZDOTDIR", directory);
    try {
      writeFileSync(busyFile, "console.log('MAINS_TEST_BUSY ' + process.pid); setInterval(() => {}, 1000);\n");
      writeFileSync(serverFile, "const http = require('node:http'); const server = http.createServer((req, res) => res.end('alive')); server.listen(0, '127.0.0.1', () => console.log('MAINS_TEST_SERVER ' + process.pid + ' ' + server.address().port));\n");
      terminalService.create(id, directory, (_id, data) => { output += data; }, { workspaceId: "busy-test" });
      terminalService.write(id, `${quote(process.execPath)} ${quote(busyFile)}\r`);
      await vi.waitFor(() => {
        const match = output.match(/MAINS_TEST_BUSY (\d+)/);
        expect(match).not.toBeNull();
        childPids[0] = Number(match![1]);
      }, { timeout: 8000, interval: 30 });
      await terminalService.refreshServers();
      expect(terminalService.list().find((entry) => entry.id === id)?.servers).toEqual([]);
      terminalService.write(id, "\x03");
      terminalService.write(id, `${quote(process.execPath)} ${quote(serverFile)}\r`);
      await vi.waitFor(() => {
        const match = output.match(/MAINS_TEST_SERVER (\d+) (\d+)/);
        expect(match).not.toBeNull();
        childPids[1] = Number(match![1]);
        port = Number(match![2]);
      }, { timeout: 8000, interval: 30 });
      await terminalService.refreshServers();
      expect(terminalService.list().find((entry) => entry.id === id)?.servers).toEqual([
        expect.objectContaining({ pid: childPids[1], port }),
      ]);
      terminalService.write(id, "\x03");
      await vi.waitFor(async () => expect(await responds(port)).toBe(false), { timeout: 3000, interval: 30 });
      await terminalService.refreshServers();
      expect(terminalService.list().find((entry) => entry.id === id)).toMatchObject({ status: "running", servers: [] });
    } finally {
      terminalService.destroy(id);
      for (const pid of childPids) { try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ } }
      vi.unstubAllEnvs();
      // macOS zsh can still finish writing its session file after SIGHUP.
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 20000);
});
