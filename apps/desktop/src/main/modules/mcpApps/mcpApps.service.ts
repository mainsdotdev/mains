import { runsService } from "@mains/backend/modules/runs";
import {
  providersService,
  createWorkAdapter,
} from "@mains/backend/modules/providers";
import { mcpAppsRegistry } from "./mcpApps.registry";
import type {
  CallMcpAppToolPayload,
  ReadMcpAppResourcePayload,
  ReadMcpAppResourceResponse,
  SendMcpAppMessagePayload,
  SendMcpAppMessageResponse,
} from "./mcpApps.dto";
import type {
  McpAppResourceCsp,
  McpAppResourceMeta,
  McpAppResourcePermissions,
} from "./mcpApps.document";
import { sanitizeMcpAppResourceCsp } from "./mcpApps.document";

const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TOOL_PAYLOAD_BYTES = 1024 * 1024;
const MAX_MESSAGE_CHARS = 32_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, name: string, max = 1_024): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${name} is too long`);
  return normalized;
}

function optionalString(value: unknown, name: string, max = 1_024): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, name, max);
}

function metadataString(value: unknown, max = 2_048): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : undefined;
}

function boundedJsonObject(
  value: unknown,
  name: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const object = record(value);
  if (!object) throw new Error(`${name} must be an object`);
  if (JSON.stringify(object).length > MAX_TOOL_PAYLOAD_BYTES) {
    throw new Error(`${name} is too large`);
  }
  return object;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length > 0 ? strings : undefined;
}

function normalizeCsp(value: unknown): McpAppResourceCsp | undefined {
  const source = record(value);
  if (!source) return undefined;
  const connectDomains = stringList(source.connectDomains ?? source.connect_domains);
  const resourceDomains = stringList(source.resourceDomains ?? source.resource_domains);
  const frameDomains = stringList(
    source.frameDomains ?? source.frame_domains,
  );
  const baseUriDomains = stringList(source.baseUriDomains ?? source.base_uri_domains);
  if (!connectDomains && !resourceDomains && !frameDomains && !baseUriDomains) {
    return undefined;
  }
  return { connectDomains, resourceDomains, frameDomains, baseUriDomains };
}

function normalizePermissions(value: unknown): McpAppResourcePermissions | undefined {
  const source = record(value);
  if (!source) return undefined;
  const enabled = (key: string) => (record(source[key]) ? {} : undefined);
  const permissions: McpAppResourcePermissions = {
    camera: enabled("camera"),
    microphone: enabled("microphone"),
    geolocation: enabled("geolocation"),
    clipboardWrite: enabled("clipboardWrite") ?? enabled("clipboard-write"),
  };
  return Object.values(permissions).some(Boolean) ? permissions : undefined;
}

function normalizeResourceMeta(value: unknown): McpAppResourceMeta {
  const meta = record(value) ?? {};
  const ui = record(meta.ui) ?? {};
  const csp = sanitizeMcpAppResourceCsp(
    normalizeCsp(ui.csp ?? meta["ui/csp"] ?? meta["openai/widgetCSP"]),
  );
  const permissions = normalizePermissions(
    ui.permissions ?? meta["ui/permissions"] ?? meta["openai/widgetPermissions"],
  );
  const domain = metadataString(
    ui.domain ?? meta["ui/domain"] ?? meta["openai/widgetDomain"],
  );
  const borderValue =
    ui.prefersBorder ?? meta["ui/prefersBorder"] ?? meta["openai/widgetPrefersBorder"];
  return {
    ...(csp ? { csp } : {}),
    ...(permissions ? { permissions } : {}),
    ...(domain ? { domain } : {}),
    ...(typeof borderValue === "boolean" ? { prefersBorder: borderValue } : {}),
  };
}

async function adapterForRun(runId: string) {
  const run = await runsService.getRunById(runId);
  if (!run) throw new Error("Run not found");
  const provider = await providersService.getById(run.providerId);
  if (!provider) throw new Error(`Provider "${run.providerId}" not found`);
  if (!provider.isEnabled) throw new Error(`Provider "${provider.displayName}" is not enabled`);
  return { run, adapter: createWorkAdapter(provider) };
}

function extractTextBlocks(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const block = record(item);
    return block?.type === "text" && typeof block.text === "string" && block.text.trim()
      ? [block.text.trim()]
      : [];
  });
}

function modelContextNote(value: SendMcpAppMessagePayload["modelContext"]): string | null {
  if (!value) return null;
  const parts = extractTextBlocks(value.content);
  if (value.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(value.structuredContent));
    } catch {
      // Ignore a non-serializable optional context value.
    }
  }
  const joined = parts.join("\n").slice(0, MAX_MESSAGE_CHARS);
  return joined || null;
}

export const mcpAppsService = {
  async readResource(raw: ReadMcpAppResourcePayload): Promise<ReadMcpAppResourceResponse> {
    const runId = requiredString(raw?.runId, "runId");
    const server = requiredString(raw?.server, "server");
    const resourceUri = requiredString(raw?.resourceUri, "resourceUri", 8_192);
    if (!resourceUri.startsWith("ui://")) {
      throw new Error("Only ui:// MCP App resources are supported");
    }

    const { adapter } = await adapterForRun(runId);
    if (!adapter.readMcpAppResource) {
      throw new Error("This provider does not support MCP App resources");
    }
    const result = await adapter.readMcpAppResource({
      runId,
      server,
      uri: resourceUri,
      originCallId: optionalString(raw.originCallId, "originCallId"),
      connectorId: optionalString(raw.connectorId, "connectorId"),
    });
    const content =
      result.contents.find((item) => item.uri === resourceUri && typeof item.text === "string") ??
      result.contents.find((item) => typeof item.text === "string");
    if (!content?.text) throw new Error("MCP App resource did not contain HTML text");
    if (Buffer.byteLength(content.text, "utf8") > MAX_RESOURCE_BYTES) {
      throw new Error("MCP App resource is too large");
    }
    const mimeType = content.mimeType ?? "";
    // MCP Apps uses text/html;profile=mcp-app. ChatGPT Apps SDK resources
    // created before the standardization use the equivalent legacy
    // text/html+skybridge media type (including Skyscanner-style cards).
    if (!/^text\/html(?:\+skybridge)?(?:\s*;|$)/i.test(mimeType)) {
      throw new Error(`Unsupported MCP App resource type: ${mimeType || "unknown"}`);
    }

    const meta = normalizeResourceMeta(content._meta);
    return {
      url: mcpAppsRegistry.register(content.text, meta),
      mimeType,
      meta,
    };
  },

  async callTool(raw: CallMcpAppToolPayload) {
    const runId = requiredString(raw?.runId, "runId");
    const server = requiredString(raw?.server, "server");
    const tool = requiredString(raw?.tool, "tool");
    const { adapter } = await adapterForRun(runId);
    if (!adapter.callMcpAppTool) {
      throw new Error("This provider does not support MCP App tool calls");
    }
    return adapter.callMcpAppTool({
      runId,
      server,
      tool,
      arguments: boundedJsonObject(raw.arguments, "arguments"),
      meta: boundedJsonObject(raw.meta, "meta"),
    });
  },

  async sendMessage(raw: SendMcpAppMessagePayload): Promise<SendMcpAppMessageResponse> {
    const runId = requiredString(raw?.runId, "runId");
    const message = extractTextBlocks(raw?.content).join("\n").slice(0, MAX_MESSAGE_CHARS);
    if (!message) throw new Error("MCP App message did not contain text");
    const { run } = await adapterForRun(runId);
    const context = modelContextNote(raw.modelContext);
    return runsService.continueRun({
      runId,
      accountId: run.accountId,
      message,
      ...(context
        ? {
            additionalContext: [
              { kind: "note", content: `Interactive MCP App context:\n${context}` },
            ],
          }
        : {}),
    });
  },
};
