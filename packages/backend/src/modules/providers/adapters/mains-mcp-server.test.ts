import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import type { VoiceTaskTools } from "../../../../shared/voice-task-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainsMcpStdioServer } from "./mains-mcp-server";

describe("Cursor ACP MCP bridges", () => {
  let directory: string;
  const servers: MainsMcpStdioServer[] = [];
  const clients: ChildProcessWithoutNullStreams[] = [];
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-acp-mcp-"));
    vi.spyOn(os, "homedir").mockReturnValue(path.join(directory, "home"));
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.kill();
    for (const server of servers.splice(0)) await server.stop();
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  async function start(runId: string) {
    const server = new MainsMcpStdioServer({ runId, workspaceId: null, rootPath: path.join(directory, "workspace") });
    servers.push(server);
    await server.start();
    return server;
  }

  function clientFor(server: MainsMcpStdioServer) {
    const config = server.mcpConfig;
    const child = spawn(config.command, config.args, { env: { ...process.env, ...Object.fromEntries(config.env.map(({ name, value }) => [name, value])) } });
    clients.push(child);
    let sequence = 0;
    let buffer = "";
    const replies = new Map<number, (reply: any) => void>();
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const reply = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        replies.get(reply.id)?.(reply.result); replies.delete(reply.id);
      }
    });
    return (method: string, params?: unknown) => new Promise<any>((resolve) => {
      const id = ++sequence; replies.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  it("uses session-local MCP configuration without modifying user or project MCP settings", async () => {
    const configs = [path.join(directory, "home", ".cursor", "mcp.json"), path.join(directory, "workspace", ".cursor", "mcp.json")];
    const existing = '{"mcpServers":{"my-server":{"command":"keep-me"}}}\n';
    for (const config of configs) { fs.mkdirSync(path.dirname(config), { recursive: true }); fs.writeFileSync(config, existing); }
    const first = await start("run-a");
    const second = await start("run-b");
    expect(first.mcpConfig).not.toEqual(second.mcpConfig);
    for (const config of configs) expect(fs.readFileSync(config, "utf8")).toBe(existing);
    await first.stop();
    expect(second.isRunning).toBe(true);
    for (const config of configs) expect(fs.readFileSync(config, "utf8")).toBe(existing);
  });

  it("does not create .cursor/mcp.json when none exists", async () => {
    await start("run-a");
    expect(fs.existsSync(path.join(directory, "home", ".cursor"))).toBe(false);
    expect(fs.existsSync(path.join(directory, "workspace", ".cursor"))).toBe(false);
  });

  it("serves only scoped voice tools over real MCP stdio and dispatches to the owning call", async () => {
    const tools: VoiceTaskTools = {
      start: vi.fn().mockResolvedValue({ runId: "worker" }), list: vi.fn(), read: vi.fn(), wait: vi.fn(),
      send: vi.fn(), cancel: vi.fn(), end: vi.fn(),
    };
    const bridge = new MainsMcpStdioServer({ runId: "voice-parent", rootPath: null, workspaceId: null, voiceTools: tools }, "chat", { provider: PROVIDER_IDS.codex, scope: "voice" });
    servers.push(bridge); await bridge.start();
    const rpc = clientFor(bridge);
    expect(await rpc("initialize")).toMatchObject({ capabilities: { tools: {} } });
    const catalog = await rpc("tools/list");
    expect(catalog.tools.map((t: { name: string }) => t.name)).toContain("EndVoiceChat");
    expect(catalog.tools).toHaveLength(7);
    const args = { taskKey: "hero", title: "Hero", prompt: "Refactor the hero" };
    expect(await rpc("tools/call", { name: "StartVoiceTask", arguments: args })).toMatchObject({ content: [{ text: '{"runId":"worker"}' }] });
    expect(tools.start).toHaveBeenCalledExactlyOnceWith(args);
    expect(await rpc("tools/call", { name: "CheckPackage", arguments: { packages: [] } })).toMatchObject({ isError: true });
    await bridge.stop();
    expect(bridge.isRunning).toBe(false);
    expect(fs.existsSync(bridge.mcpConfig.args[0])).toBe(false);
  });

  it("releases a pending wait socket when the session stops", async () => {
    const wait = vi.fn(() => new Promise(() => {}));
    const bridge = new MainsMcpStdioServer({ runId: "voice-parent", rootPath: null, workspaceId: null, voiceTools: { wait } as never }, "work", { provider: PROVIDER_IDS.codex, scope: "voice" });
    servers.push(bridge); await bridge.start();
    const rpc = clientFor(bridge);
    const pending = rpc("tools/call", { name: "WaitVoiceTask", arguments: { runId: "worker", timeoutMs: 30000 } });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    await bridge.stop();
    await expect(pending).resolves.toMatchObject({ isError: true });
  });
});
