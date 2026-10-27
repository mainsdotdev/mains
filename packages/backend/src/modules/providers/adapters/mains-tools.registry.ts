// ─────────────────────────────────────────────────────────────
// Mains tool registry — the deep module behind the driver seam
//
// Each mains tool is declared once here as { name, description, schema,
// handler, providers }. The per-SDK *renderers* (toClaudeTools,
// toCopilotTools, toMcpToolDefs, toCodexDynamicTools) are the adapters at
// the seam: they are the only place naming, return shape, and availability
// differences between the four drivers live.
//
//   • Claude  → in-process MCP server, wants a Zod raw shape per tool
//   • Copilot → custom tools, JSON Schema, `mcp__mains__` name prefix,
//               result unwrapped to a string
//   • Cursor  → stdio MCP script, JSON Schema embedded as `inputSchema`
//   • Codex   → dynamic tools, JSON Schema as `inputSchema`
//
// `providers` records which drivers expose each tool. See CONTEXT.md
// "Provider adapters" for why CheckPackage is absent from Claude/Copilot.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";
import { handleAtlasReadPage, handleAtlasCreatePage, handleAtlasUpdatePage, handleAtlasListCovers } from "./atlas-tools";
import type { Tool as CopilotTool } from "@github/copilot-sdk";
import { PROVIDER_IDS, type ProviderId } from "@mains/contracts/provider-ids";
import type { JsonValue } from "./codex-app-server-protocol/generated/serde_json/JsonValue";
import type { DynamicToolSpec } from "./codex-app-server-protocol/generated/v2/DynamicToolSpec";
import { DEFAULT_MODE_ID, providerSupportsMode, type ModeId } from "@mains/contracts/modes";
import {
  TOOL_DESCRIPTIONS,
  handleSaveReview,
  handleSaveFinding,
  handleSaveFindings,
  handleCheckPackage,
  handleRegisterDeliverable,
  handleStartVoiceTask, handleListVoiceTasks, handleReadVoiceTask, handleWaitVoiceTask,
  handleSendVoiceTaskMessage, handleStopVoiceTask, handleEndVoiceChat,
  type MainsToolContext,
} from "./mains-tools.core";
import {
  AtlasReadPageSchema, AtlasCreatePageSchema, AtlasUpdatePageSchema, AtlasListCoversSchema,
  SaveReviewSchema,
  SaveFindingSchema,
  SaveFindingsSchema,
  CheckPackageSchema,
  RegisterDeliverableSchema,
  StartVoiceTaskSchema, ListVoiceTasksSchema, ReadVoiceTaskSchema, WaitVoiceTaskSchema,
  SendVoiceTaskMessageSchema, StopVoiceTaskSchema, EndVoiceChatSchema,
} from "./mains-tools.schemas";

/**
 * The MCP-style result every mains handler returns.
 *
 * A handler reports failure by throwing; every driver surfaces a throw as a
 * tool error. A result describes an outcome, including a negative verdict such
 * as a blocked package. `isError` is left to the seam itself (an unknown tool).
 */
export type MainsToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface MainsToolDef {
  /** Bare tool name (no SDK prefix — that's a renderer concern). */
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  /** Takes the model's raw args; `defineTool` validates them before the real handler runs. */
  handler: (args: unknown, ctx: MainsToolContext) => Promise<MainsToolResult>;
  /** Which drivers expose this tool. */
  providers: ProviderId[];
  /** Which experience modes expose this tool. Absent = every mode. */
  modes?: ModeId[];
  scope?: "voice";
}

/**
 * Declare a tool. Only Claude's SDK validates args against the tool's shape;
 * Codex, Cursor and Copilot hand the model's raw args to the handler. Parsing
 * here gives every driver the same validation, and types the handler's args
 * from the schema.
 */
function defineTool<S extends z.ZodObject<any>>(
  def: Omit<MainsToolDef, "schema" | "handler"> & {
    schema: S;
    handler: (args: z.infer<S>, ctx: MainsToolContext) => Promise<MainsToolResult>;
  },
): MainsToolDef {
  return {
    ...def,
    handler: async (args, ctx) => {
      const parsed = def.schema.safeParse(args ?? {});
      if (!parsed.success) {
        throw new Error(`Invalid arguments for ${def.name}:\n${z.prettifyError(parsed.error)}`);
      }
      return def.handler(parsed.data, ctx);
    },
  };
}

/** Voice coordination tools: Codex only, and only on a voice bridge. */
const voiceTool = <S extends z.ZodObject<any>>(
  name: keyof typeof TOOL_DESCRIPTIONS,
  schema: S,
  handler: (args: z.infer<S>, ctx: MainsToolContext) => Promise<MainsToolResult>,
) => defineTool({
  name, description: TOOL_DESCRIPTIONS[name], schema, handler,
  providers: [PROVIDER_IDS.codex], scope: "voice",
});

// Availability groups, named so the asymmetry is self-documenting.
// The review-flow tools are not exposed to Codex (it is a code-writing flow).
const REVIEW_FLOW: ProviderId[] = [
  PROVIDER_IDS.claude,
  PROVIDER_IDS.copilot,
  PROVIDER_IDS.cursor,
];
// CheckPackage: Claude/Copilot guard packages via a PreToolUse Bash hook, so
// they need no explicit tool; Codex/Cursor cannot hook that path. Deliberate.
const PACKAGE_GUARD: ProviderId[] = [PROVIDER_IDS.codex, PROVIDER_IDS.cursor];

// Review and package tools belong to Developer; file delivery also belongs
// to Work. Availability is declared per tool and checked against provider modes.
const DEVELOPER_ONLY: ModeId[] = ["developer"];

// Atlas serves Work and Chat, which only Claude and Codex offer (PROVIDER_MODES
// in contracts/modes); Copilot and Cursor stay Developer-only.
const ATLAS: ProviderId[] = [PROVIDER_IDS.codex, PROVIDER_IDS.claude];

export const MAINS_TOOLS: MainsToolDef[] = [
  defineTool({
    name: "RegisterDeliverable", description: TOOL_DESCRIPTIONS.RegisterDeliverable,
    schema: RegisterDeliverableSchema, handler: handleRegisterDeliverable,
    providers: [PROVIDER_IDS.codex, PROVIDER_IDS.claude, PROVIDER_IDS.copilot, PROVIDER_IDS.cursor],
    modes: ["developer", "work"],
  }),
  defineTool({
    name: "AtlasReadPage", description: TOOL_DESCRIPTIONS.AtlasReadPage,
    schema: AtlasReadPageSchema, handler: handleAtlasReadPage,
    providers: ATLAS,
  }),
  defineTool({
    name: "AtlasCreatePage", description: TOOL_DESCRIPTIONS.AtlasCreatePage,
    schema: AtlasCreatePageSchema, handler: handleAtlasCreatePage,
    providers: ATLAS, modes: ["work"],
  }),
  defineTool({
    name: "AtlasUpdatePage", description: TOOL_DESCRIPTIONS.AtlasUpdatePage,
    schema: AtlasUpdatePageSchema, handler: handleAtlasUpdatePage,
    providers: ATLAS, modes: ["work"],
  }),
  defineTool({
    name: "AtlasListCovers", description: TOOL_DESCRIPTIONS.AtlasListCovers,
    schema: AtlasListCoversSchema, handler: handleAtlasListCovers,
    providers: ATLAS, modes: ["work"],
  }),
  voiceTool("StartVoiceTask", StartVoiceTaskSchema, handleStartVoiceTask),
  voiceTool("ListVoiceTasks", ListVoiceTasksSchema, handleListVoiceTasks),
  voiceTool("ReadVoiceTask", ReadVoiceTaskSchema, handleReadVoiceTask),
  voiceTool("WaitVoiceTask", WaitVoiceTaskSchema, handleWaitVoiceTask),
  voiceTool("SendVoiceTaskMessage", SendVoiceTaskMessageSchema, handleSendVoiceTaskMessage),
  voiceTool("StopVoiceTask", StopVoiceTaskSchema, handleStopVoiceTask),
  voiceTool("EndVoiceChat", EndVoiceChatSchema, handleEndVoiceChat),
  defineTool({
    name: "SaveReview",
    description: TOOL_DESCRIPTIONS.SaveReview,
    schema: SaveReviewSchema,
    handler: handleSaveReview,
    providers: REVIEW_FLOW,
    modes: DEVELOPER_ONLY,
  }),
  defineTool({
    name: "SaveFinding",
    description: TOOL_DESCRIPTIONS.SaveFinding,
    schema: SaveFindingSchema,
    handler: handleSaveFinding,
    providers: REVIEW_FLOW,
    modes: DEVELOPER_ONLY,
  }),
  defineTool({
    name: "SaveFindings",
    description: TOOL_DESCRIPTIONS.SaveFindings,
    schema: SaveFindingsSchema,
    handler: handleSaveFindings,
    providers: REVIEW_FLOW,
    modes: DEVELOPER_ONLY,
  }),
  defineTool({
    name: "CheckPackage",
    description: TOOL_DESCRIPTIONS.CheckPackage,
    schema: CheckPackageSchema,
    handler: handleCheckPackage,
    providers: PACKAGE_GUARD,
    modes: DEVELOPER_ONLY,
  }),
];

const BY_NAME = new Map(MAINS_TOOLS.map((t) => [t.name, t]));

function forProvider(
  provider: ProviderId,
  mode: ModeId = DEFAULT_MODE_ID,
  scope?: "voice",
): MainsToolDef[] {
  return MAINS_TOOLS.filter(
    (t) => providerSupportsMode(provider, mode) && t.scope === scope && t.providers.includes(provider) && (t.modes?.includes(mode) ?? true),
  );
}

/**
 * Render a tool's Zod schema to JSON Schema, stripping the `$schema` meta key
 * and `additionalProperties` so the result matches the open shape the drivers
 * declared by hand (agents may still pass through extra fields).
 */
function sanitizeJsonSchema(node: any): any {
  if (Array.isArray(node)) return node.map(sanitizeJsonSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$schema" || key === "additionalProperties") continue;
      out[key] = sanitizeJsonSchema(value);
    }
    return out;
  }
  return node;
}

export function toJsonSchema(schema: z.ZodObject<any>): Record<string, unknown> {
  return sanitizeJsonSchema(z.toJSONSchema(schema));
}

/** Dispatch a tool call to its handler. Replaces the per-driver switches. */
export async function dispatchMainsTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: MainsToolContext,
): Promise<MainsToolResult> {
  const def = BY_NAME.get(toolName);
  if (!def) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }
  return def.handler(args, ctx);
}

// ─────────────────────────────────────────────────────────────
// Renderers (the adapters at the seam)
// ─────────────────────────────────────────────────────────────

/** Claude SDK `tool()` wants (name, description, raw Zod shape, handler). */
export interface ClaudeToolSpec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  handler: (args: any) => Promise<MainsToolResult>;
}

export function toClaudeTools(
  ctx: MainsToolContext,
  mode: ModeId = DEFAULT_MODE_ID,
): ClaudeToolSpec[] {
  return forProvider(PROVIDER_IDS.claude, mode).map((t) => ({
    name: t.name,
    description: t.description,
    shape: t.schema.shape,
    handler: (args: any) => t.handler(args, ctx),
  }));
}

/**
 * Copilot custom tool: prefixed name, JSON Schema params. A plain result is
 * returned as a string; an `isError` one as a `failure` result object, since a
 * bare string reads as success to Copilot.
 */
export function toCopilotTools(
  ctx: MainsToolContext,
  mode: ModeId = DEFAULT_MODE_ID,
): CopilotTool[] {
  return forProvider(PROVIDER_IDS.copilot, mode).map((t) => ({
    name: `mcp__mains__${t.name}`,
    description: t.description,
    parameters: toJsonSchema(t.schema),
    handler: async (args) => {
      const result = await t.handler(args, ctx);
      const text = result.content.map((item) => item.text).join("\n");
      return result.isError ? { resultType: "failure" as const, textResultForLlm: text, error: text } : text;
    },
  }));
}

/** JSON-Schema tool definition for a session-local stdio MCP script. */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function toMcpToolDefs(mode: ModeId = DEFAULT_MODE_ID, provider: ProviderId = PROVIDER_IDS.cursor, scope?: "voice"): McpToolDef[] {
  return forProvider(provider, mode, scope).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t.schema),
  }));
}

/**
 * Codex dynamic tools — the MCP JSON-Schema shape plus the `"function"` tag.
 *
 * `DynamicToolSpec` is a tagged union (`function` | `namespace`). The tag is
 * required by the schema; the app-server's deserializer happens to fall back
 * to the `function` variant when it is absent, but that is an implementation
 * detail of serde, not a contract. Name it.
 */
export function toCodexDynamicTools(
  mode: ModeId = DEFAULT_MODE_ID,
): DynamicToolSpec[] {
  return forProvider(PROVIDER_IDS.codex, mode).map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    // `toJsonSchema` is typed loosely for the three renderers that share it;
    // its output is a sanitized JSON Schema, so it is JSON by construction.
    inputSchema: toJsonSchema(t.schema) as JsonValue,
  }));
}
