import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MainsMcpStdioServer } from "./mains-mcp-server";

describe("Cursor ACP MCP bridges", () => {
  let directory: string;
  const servers: MainsMcpStdioServer[] = [];
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-acp-mcp-"));
    vi.spyOn(os, "homedir").mockReturnValue(path.join(directory, "home"));
  });
  afterEach(async () => {
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
});
