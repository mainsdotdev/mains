import type { ContextMcpAppItem } from "./composer-context";
import type { Attachments, InitialContextItem } from "./run-context-payload";

type BlockPresentation = {
  _meta?: { "openai/title"?: string };
  annotations?: { audience?: Array<"user" | "assistant"> };
};
export type McpAppContextBlock = BlockPresentation & (
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; title?: string; description?: string; mimeType?: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } }
);

export interface McpAppModelContext {
  content?: McpAppContextBlock[];
  structuredContent?: Record<string, unknown>;
}

export interface McpAppModelContextState extends McpAppModelContext {
  updateId: string;
}

export interface McpAppMessageOptions {
  target?: "active" | "new";
}

const MAX_CONTEXT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 128_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, required = false): string | undefined {
  if (typeof value !== "string" || value.length > MAX_TEXT_CHARS) {
    if (required) throw new Error("Invalid MCP App text content");
    return undefined;
  }
  return value;
}

/** Only declared content reaches the model; transport/auth metadata stays in the app. */
export function normalizeMcpAppContext(value: unknown): McpAppModelContext {
  const source = record(value);
  if (!source) throw new Error("MCP App context must be an object");
  if (new TextEncoder().encode(JSON.stringify(source)).length > MAX_CONTEXT_BYTES) {
    throw new Error("MCP App context is too large");
  }
  if (source.content !== undefined && !Array.isArray(source.content)) {
    throw new Error("MCP App content must be an array");
  }
  if (Array.isArray(source.content) && source.content.length > 64) {
    throw new Error("MCP App has too many content blocks");
  }
  if (source.structuredContent !== undefined && !record(source.structuredContent)) {
    throw new Error("MCP App structured content must be an object");
  }
  const content = (source.content as unknown[] | undefined)?.map((value): McpAppContextBlock => {
    const block = record(value);
    if (!block) throw new Error("Invalid MCP App content block");
    const title = text(record(block._meta)?.["openai/title"]);
    const audience = record(block.annotations)?.audience;
    const presentation: BlockPresentation = {
      ...(title?.trim() ? { _meta: { "openai/title": title.trim().slice(0, 240) } } : {}),
      ...(Array.isArray(audience) ? { annotations: {
        audience: audience.filter((item): item is "user" | "assistant" => item === "user" || item === "assistant"),
      } } : {}),
    };
    switch (block.type) {
      case "text":
        return { type: "text", text: text(block.text, true)!, ...presentation };
      case "image": {
        if (typeof block.data !== "string" || !block.data || !/^[A-Za-z0-9+/]*={0,2}$/.test(block.data) ||
            typeof block.mimeType !== "string" || !/^image\/(png|jpeg|webp|gif)$/.test(block.mimeType)) {
          throw new Error("Unsupported MCP App image");
        }
        return { type: "image", data: block.data, mimeType: block.mimeType, ...presentation };
      }
      case "resource_link":
        return { type: "resource_link", uri: text(block.uri, true)!, name: text(block.name, true)!,
          ...(text(block.title) ? { title: text(block.title) } : {}),
          ...(text(block.description) ? { description: text(block.description) } : {}),
          ...(text(block.mimeType) ? { mimeType: text(block.mimeType) } : {}), ...presentation };
      case "resource": {
        const resource = record(block.resource);
        if (!resource || (typeof resource.text !== "string" && typeof resource.blob !== "string")) {
          throw new Error("Invalid MCP App embedded resource");
        }
        return { type: "resource", resource: {
          uri: text(resource.uri, true)!,
          ...(text(resource.mimeType) ? { mimeType: text(resource.mimeType) } : {}),
          ...(resource.text !== undefined ? { text: text(resource.text, true)! } : {}),
          ...(typeof resource.blob === "string" ? { blob: resource.blob } : {}),
        }, ...presentation };
      }
      default:
        throw new Error(`Unsupported MCP App content: ${String(block.type)}`);
    }
  });
  return {
    ...(content ? { content } : {}),
    ...(record(source.structuredContent) ? { structuredContent: source.structuredContent as Record<string, unknown> } : {}),
  };
}

export function mcpAppContextItems(sessionId: string, appName: string, state: McpAppModelContextState | null): ContextMcpAppItem[] {
  if (!state) return [];
  const items: ContextMcpAppItem[] = (state.content ?? []).map((block, index) => ({
    kind: "mcp-app", id: `${sessionId}:${index}`, sessionId, appName, updateId: state.updateId,
    label: block._meta?.["openai/title"] || (block.type === "resource_link" ? block.title || block.name : `${appName} selection`),
    hidden: block.annotations?.audience?.length === 1 && block.annotations.audience[0] === "assistant",
    block,
  }));
  if (state.structuredContent && Object.keys(state.structuredContent).length) {
    items.push({ kind: "mcp-app", id: `${sessionId}:structured`, sessionId, appName,
      updateId: state.updateId, label: `${appName} context`, hidden: true, structuredContent: state.structuredContent });
  }
  return items;
}

/** Each block has its own chip; removing one leaves the other blocks attached. */
export function mcpAppContextState(items: readonly ContextMcpAppItem[], sessionId: string): McpAppModelContextState | null {
  const owned = items.filter((item) => item.sessionId === sessionId);
  if (!owned.length) return null;
  const content = owned.flatMap((item) => item.block ? [item.block] : []);
  const structuredContent = owned.find((item) => item.structuredContent)?.structuredContent;
  return { updateId: owned[0].updateId, ...(content.length ? { content } : {}),
    ...(structuredContent ? { structuredContent } : {}) };
}

export function mcpAppContextPayload(items: readonly ContextMcpAppItem[]): {
  attachments: Attachments; initialContext: InitialContextItem[];
} {
  const attachments: Attachments = [];
  const initialContext: InitialContextItem[] = [];
  for (const item of items) {
    const block = item.block;
    if (block?.type === "image") {
      attachments.push({ name: `${item.appName}-selection-${item.id.slice(item.sessionId.length + 1)}.${block.mimeType.split("/")[1]}`,
        type: "image", data: block.data, mimeType: block.mimeType });
      continue;
    }
    const content = item.structuredContent ? JSON.stringify(item.structuredContent)
      : block?.type === "text" ? block.text
      : block?.type === "resource_link" ? JSON.stringify({ uri: block.uri, name: block.name,
        title: block.title, description: block.description, mimeType: block.mimeType })
      : block?.type === "resource" ? JSON.stringify(block.resource) : "";
    if (content) initialContext.push({ kind: "selection", ref: item.appName, content,
      metadata: { source: "mcp-app", appName: item.appName, id: item.id } });
  }
  return { attachments, initialContext };
}

export function mcpAppMessageText(content: unknown): string {
  const context = normalizeMcpAppContext({ content });
  if (context.content?.some((block) => block.type !== "text")) {
    throw new Error("This host supports text app messages; attach images with model context");
  }
  const message = (context.content ?? []).map((block) => block.type === "text" ? block.text : "").join("\n").trim();
  if (!message || message.length > 32_000) throw new Error("MCP App message must contain up to 32,000 characters of text");
  return message;
}

/** Transport options control routing, never become model context. */
export function mcpAppMessageOptions(meta: unknown): McpAppMessageOptions {
  const value = record(meta)?.["openai/message"];
  if (value === undefined) return {};
  const options = record(value);
  if (!options || (options.target !== undefined && options.target !== "active" && options.target !== "new") ||
      (options.send !== undefined && options.send !== true)) {
    throw new Error("Unsupported MCP App message options");
  }
  return options.target ? { target: options.target as "active" | "new" } : {};
}
