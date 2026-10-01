import { randomUUID } from "node:crypto";
import type { McpAppEntrypoint, McpAppIcon } from "@mains/contracts/mcp-apps";
import type { McpAppCallToolResult, McpAppExtensionSession, PluginInfo } from "../../../../shared/adapter.types";
import type { CodexAppServer } from "./codex-app-server.client";
import type { CodexAppServerParams } from "./codex-app-server-protocol/rpc";
import type { McpServerStatus } from "./codex-app-server-protocol/generated/v2/McpServerStatus";
import type { McpResourceReadTarget } from "./codex-app-server-protocol/generated/v2/McpResourceReadTarget";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Synthetic links identify an unlinked app, not an authenticated account. */
export function codexMcpResourceTarget(app: {
  server: string;
  connectorId?: string;
  linkId?: string | null;
}): McpResourceReadTarget | undefined {
  const connectorId = text(app.connectorId);
  const linkId = app.linkId === null ? null : text(app.linkId);
  if (app.server !== "codex_apps" || !connectorId || linkId === undefined) return undefined;
  return { connectorId, linkId: linkId?.startsWith("synthetic_link::") ? null : linkId };
}

function icons(value: unknown): McpAppIcon[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.slice(0, 16).flatMap((value) => {
    const icon = record(value);
    const src = text(icon.src);
    if (!src) return [];
    return [{ src, mimeType: text(icon.mimeType),
      ...(icon.theme === "light" || icon.theme === "dark" ? { theme: icon.theme } : {}),
    } as McpAppIcon];
  });
  return result.length ? result : undefined;
}

export function discoverMcpAppEntrypoints(statuses: McpServerStatus[]): McpAppEntrypoint[] {
  return statuses.flatMap((server) => Object.values(server.tools).flatMap((tool) => {
    if (!tool) return [];
    const meta = record(tool._meta);
    const ui = record(meta.ui);
    const extension = record(meta["openai/ui"]);
    const uri = text(ui.resourceUri);
    const types = Array.isArray(extension.entrypoints)
      ? extension.entrypoints.map((entry) => record(entry).type)
          .filter((type): type is "global" | "thread" => type === "global" || type === "thread")
      : [];
    if (!uri?.startsWith("ui://") || !types.length) return [];
    const connectorId = text(meta.connector_id);
    const linkId = meta.link_id === null ? null : text(meta.link_id);
    return [{
      id: JSON.stringify([server.name, tool.name, connectorId ?? null, linkId ?? null]),
      name: text(tool.title) ?? text(record(tool.annotations).title) ?? text(meta.connector_name) ?? tool.name,
      server: server.name,
      tool: tool.name,
      resourceUri: uri,
      pluginId: server.pluginId ?? undefined,
      icons: icons(tool.icons) ?? icons(server.serverInfo?.icons),
      connectorId,
      ...(linkId !== undefined ? { linkId } : {}),
      entrypoints: [...new Set(types)],
      preferredModelDisplayMode: extension.preferredModelDisplayMode === "inline" ? "inline" : "fullscreen",
    }];
  }));
}

export interface McpAppPluginSource {
  plugin: PluginInfo;
  connectorIds: string[];
  mcpServers: string[];
}

/** Ownership comes from server.pluginId or plugin/read, never a display-name match. */
export function installedMcpAppEntrypoints(
  entries: McpAppEntrypoint[],
  sources: McpAppPluginSource[],
): McpAppEntrypoint[] {
  return entries.flatMap((entry) => {
    const owner = sources.find(({ plugin, connectorIds, mcpServers }) =>
      plugin.installed && plugin.enabled && (entry.pluginId
        ? entry.pluginId === plugin.id
        : entry.connectorId ? connectorIds.includes(entry.connectorId) : mcpServers.includes(entry.server)));
    if (!owner) return [];
    const icon = owner.plugin.interface?.composerIcon ?? owner.plugin.interface?.logo;
    return [{ ...entry, pluginId: owner.plugin.id, icons: entry.icons ?? (icon ? [{ src: icon }] : undefined) }];
  });
}

interface Options {
  ensureServer: () => Promise<CodexAppServer>;
  readInventory: () => Promise<McpServerStatus[]>;
  listEntrypoints?: (inventory: McpServerStatus[]) => Promise<McpAppEntrypoint[]>;
}

/** Idle ephemeral threads provide MCP connections; this module never starts a turn. */
export function createCodexMcpApps({ ensureServer, readInventory, listEntrypoints }: Options) {
  const sessions = new Map<string, {
    server: CodexAppServer;
    threadId: string;
    app: McpAppEntrypoint;
    tools: Map<string, string>;
  }>();

  async function close(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    await session.server.sendRequest("thread/unsubscribe", { threadId: session.threadId });
  }

  return {
    async open(entrypointId: string): Promise<McpAppExtensionSession> {
      if (sessions.size >= 16) throw new Error("Close an app before opening another one");
      const inventory = await readInventory();
      const entries = listEntrypoints ? await listEntrypoints(inventory) : discoverMcpAppEntrypoints(inventory);
      const app = entries.find((entry) => entry.id === entrypointId);
      if (!app) throw new Error("This plugin app is no longer available");
      const tools = new Map<string, string>();
      const prefix = app.tool.includes(".") ? app.tool.slice(0, app.tool.indexOf(".") + 1) : "";
      for (const tool of Object.values(inventory.find((entry) => entry.name === app.server)?.tools ?? {})) {
        if (!tool) continue;
        const meta = record(tool._meta);
        const visibility = record(meta.ui).visibility;
        if (Array.isArray(visibility) && !visibility.includes("app")) continue;
        if (app.connectorId
          ? text(meta.connector_id) !== app.connectorId
          : text(meta.connector_id) !== undefined || (prefix && !tool.name.startsWith(prefix))) continue;
        if (app.linkId !== undefined && meta.link_id !== app.linkId) continue;
        tools.set(tool.name, tool.name);
        if (prefix && tool.name.startsWith(prefix)) tools.set(tool.name.slice(prefix.length), tool.name);
      }
      const server = await ensureServer();
      const { thread } = await server.sendRequest("thread/start", {
        ephemeral: true,
        sandbox: "read-only",
        approvalPolicy: "on-request",
      });
      const id = randomUUID();
      sessions.set(id, { server, threadId: thread.id, app, tools });
      try {
        const target = codexMcpResourceTarget(app);
        const resource = await server.sendRequest("mcpServer/resource/read", {
          threadId: thread.id,
          server: app.server,
          uri: app.resourceUri,
          ...(app.connectorId ? { connectorId: app.connectorId } : {}),
          ...(target ? { target } : {}),
        });
        const output = await server.sendRequest("mcpServer/tool/call", {
          threadId: thread.id, server: app.server, tool: app.tool, arguments: {},
        });
        if (output.isError) throw new Error(`Could not open ${app.name}; reconnect the plugin and try again`);
        return { id, app, resource, output };
      } catch (error) {
        await close(id).catch(() => {});
        throw error;
      }
    },
    async callTool(sessionId: string, name: string, args?: Record<string, unknown>, meta?: Record<string, unknown>): Promise<McpAppCallToolResult> {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("App session expired; reopen the app");
      const tool = session.tools.get(name);
      if (!tool) throw new Error("This tool is not available to this app");
      return session.server.sendRequest("mcpServer/tool/call", {
        threadId: session.threadId, server: session.app.server, tool,
        arguments: args as CodexAppServerParams<"mcpServer/tool/call">["arguments"],
        _meta: meta as CodexAppServerParams<"mcpServer/tool/call">["_meta"],
      }, 60_000);
    },
    close,
    clear(): void { sessions.clear(); },
  };
}
