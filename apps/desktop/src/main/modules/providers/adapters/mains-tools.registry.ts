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
import { PROVIDER_IDS, type ProviderId } from "../../../../shared/provider-ids";
import type { JsonValue } from "./codex-app-server-protocol/generated/serde_json/JsonValue";
import type { DynamicToolSpec } from "./codex-app-server-protocol/generated/v2/DynamicToolSpec";
import { DEFAULT_MODE_ID, type ModeId } from "../../../../shared/modes";
import {
  TOOL_DESCRIPTIONS,
  handleSaveReview,
  handleSaveFinding,
  handleSaveFindings,
  handleCheckPackage,
  type MainsToolContext,
} from "./mains-tools.core";
import {
  SaveReviewSchema,
  SaveFindingSchema,
  SaveFindingsSchema,
  CheckPackageSchema,
} from "./mains-tools.schemas";

/** The MCP-style result every mains handler returns. */
export type MainsToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface MainsToolDef {
  /** Bare tool name (no SDK prefix — that's a renderer concern). */
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  handler: (args: any, ctx: MainsToolContext) => Promise<MainsToolResult>;
  /** Which drivers expose this tool. */
  providers: ProviderId[];
  /** Which experience modes expose this tool. Absent = every mode. */
  modes?: ModeId[];
}

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

// Mode group. Every mains tool belongs to the developer experience: the
// review flow needs a workspace, and package installs are a coding concern.
// Work and chat expose none — the field stays per-tool so a future tool can
// widen without reopening the drivers.
const DEVELOPER_ONLY: ModeId[] = ["developer"];

export const MAINS_TOOLS: MainsToolDef[] = [
  {
    name: "SaveReview",
    description: TOOL_DESCRIPTIONS.SaveReview,
    schema: SaveReviewSchema,
    handler: handleSaveReview,
    providers: REVIEW_FLOW,
    modes: DEVELOPER_ONLY,
  },
  {
    name: "SaveFinding",
    description: TOOL_DESCRIPTIONS.SaveFinding,
    schema: SaveFindingSchema,
    handler: handleSaveFinding,
    providers: REVIEW_FLOW,
    modes: DEVELOPER_ONLY,
  },
  {
    name: "SaveFindings",
    description: TOOL_DESCRIPTIONS.SaveFindings,
    schema: SaveFindingsSchema,
    handler: handleSaveFindings,
    providers: REVIEW_FLOW,
    modes: DEVELOPER_ONLY,
  },
  {
    name: "CheckPackage",
    description: TOOL_DESCRIPTIONS.CheckPackage,
    schema: CheckPackageSchema,
    handler: handleCheckPackage,
    providers: PACKAGE_GUARD,
    modes: DEVELOPER_ONLY,
  },
];

const BY_NAME = new Map(MAINS_TOOLS.map((t) => [t.name, t]));

function forProvider(
  provider: ProviderId,
  mode: ModeId = DEFAULT_MODE_ID,
): MainsToolDef[] {
  return MAINS_TOOLS.filter(
    (t) => t.providers.includes(provider) && (t.modes?.includes(mode) ?? true),
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

/** Copilot custom tool: prefixed name, JSON Schema params, string result. */
export interface CopilotToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: any) => Promise<string>;
}

export function toCopilotTools(
  ctx: MainsToolContext,
  mode: ModeId = DEFAULT_MODE_ID,
): CopilotToolSpec[] {
  return forProvider(PROVIDER_IDS.copilot, mode).map((t) => ({
    name: `mcp__mains__${t.name}`,
    description: t.description,
    parameters: toJsonSchema(t.schema),
    handler: async (args: any) => {
      const result = await t.handler(args, ctx);
      return result.content[0]?.text ?? "";
    },
  }));
}

/** JSON-Schema tool definition for the Cursor stdio MCP script. */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function toMcpToolDefs(mode: ModeId = DEFAULT_MODE_ID): McpToolDef[] {
  return forProvider(PROVIDER_IDS.cursor, mode).map((t) => ({
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
