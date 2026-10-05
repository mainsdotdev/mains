// ─────────────────────────────────────────────────────────────
// Mains MCP Tools — Shared handler logic
//
// This module holds the handler implementations and descriptions; each
// adapter wraps them into its SDK-specific format (see the registry's
// renderers). Which drivers and modes see which tool is the registry's call,
// not this file's.
// ─────────────────────────────────────────────────────────────

import {
  workspaceService,
  logWorkspaceActivity,
  emitFindingsChanged,
} from "../../workspace";
import type {
  SaveReviewArgs,
  SaveFindingArgs,
  SaveFindingsArgs,
  CheckPackageArgs,
} from "./mains-tools.schemas";
import type { VoiceTaskTools } from "../../../../shared/voice-task-tools";
import {
  StartVoiceTaskSchema, ListVoiceTasksSchema, ReadVoiceTaskSchema, WaitVoiceTaskSchema,
  SendVoiceTaskMessageSchema, StopVoiceTaskSchema, EndVoiceChatSchema,
} from "./mains-tools.schemas";

/**
 * Context values captured at run start and threaded through every handler.
 */
export interface MainsToolContext {
  workspaceId: string | null;
  rootPath: string | null;
  runId: string | null;
  voiceTools?: VoiceTaskTools;
}

// ─────────────────────────────────────────────────────────────
// Tool descriptions (shared between Claude MCP + Copilot custom tools)
// ─────────────────────────────────────────────────────────────

export const TOOL_DESCRIPTIONS = {
  SaveReview:
    "Create a new review record. Returns the generated review ID. Workspace and run are automatically set from the current session.",
  SaveFinding:
    "Save a single code review finding. Returns the generated finding ID.",
  SaveFindings:
    "Save multiple code review findings at once. Returns all generated finding IDs.",
  CheckPackage:
    "IMPORTANT: Call this tool only before explicitly adding named packages (for example: npm install axios, pnpm add zod, pip install requests, cargo add serde). Do NOT call it for dependency restore commands with no package names, such as npm install, npm ci, pnpm install, yarn install, or bun install. Checks packages against a dependency security service and returns safety scores, risk levels, and alerts. If any package is blocked, do NOT install it — inform the user instead.",
  StartVoiceTask: "Delegate user-requested project work or a multi-step task to a separate visible working chat. Inherits this chat's account, workspace, model and permissions. Returns immediately; creation is not completion. Repeated taskKey returns the existing chat without resending the prompt. For follow-ups use SendVoiceTaskMessage. Independent work needs a new taskKey.",
  ListVoiceTasks: "List this voice conversation's linked working chats and their current status. Use before starting work that may already have a chat.",
  ReadVoiceTask: "Read verified progress, latest report, tool activity and pending user action from a linked working chat. Never infer completion from a spoken acknowledgment.",
  WaitVoiceTask: "Wait up to 30 seconds for a linked chat to change, finish or need attention. Pass afterCursor from a prior read. Use sparingly; completion is also delivered automatically to the voice conversation.",
  SendVoiceTaskMessage: "Send an explicitly user-authorized correction, additional instruction or request to resume to the same linked working chat. Steers a running turn, continues an idle chat. Preserve messageId on delivery retries; do not resend with a new ID after an uncertain result.",
  StopVoiceTask: "Stop a linked working chat only when the user explicitly asks to stop that task. Ending the voice conversation does not stop its working chats.",
  EndVoiceChat: "End this voice call only when the user explicitly asks to end or close the voice conversation. Leaves working chats running. Do not end the call just because a task completes.",
} as const;

async function voiceResult(ctx: MainsToolContext, call: (tools: VoiceTaskTools) => Promise<unknown>) {
  if (!ctx.voiceTools) throw new Error("Voice coordination is unavailable outside the active voice session.");
  return { content: [{ type: "text" as const, text: JSON.stringify(await call(ctx.voiceTools)) }] };
}
export const handleStartVoiceTask = (args: unknown, ctx: MainsToolContext) => voiceResult(ctx, (t) => t.start(StartVoiceTaskSchema.parse(args)));
export const handleListVoiceTasks = (args: unknown, ctx: MainsToolContext) => voiceResult(ctx, (t) => { ListVoiceTasksSchema.parse(args); return t.list(); });
export const handleReadVoiceTask = (args: unknown, ctx: MainsToolContext) => voiceResult(ctx, (t) => t.read(ReadVoiceTaskSchema.parse(args)));
export const handleWaitVoiceTask = (args: unknown, ctx: MainsToolContext) => voiceResult(ctx, (t) => t.wait(WaitVoiceTaskSchema.parse(args)));
export const handleSendVoiceTaskMessage = (args: unknown, ctx: MainsToolContext) => voiceResult(ctx, (t) => t.send(SendVoiceTaskMessageSchema.parse(args)));
export const handleStopVoiceTask = (args: unknown, ctx: MainsToolContext) => voiceResult(ctx, (t) => t.cancel(StopVoiceTaskSchema.parse(args)));
export const handleEndVoiceChat = (args: unknown, ctx: MainsToolContext) => voiceResult(ctx, (t) => { EndVoiceChatSchema.parse(args); return t.end(); });

// ─────────────────────────────────────────────────────────────
// Handler implementations
// ─────────────────────────────────────────────────────────────

export async function handleSaveReview(
  args: SaveReviewArgs,
  ctx: MainsToolContext,
) {
  const reviewId = await workspaceService.createReview({
    workspaceId: ctx.workspaceId ?? undefined,
    title: args.title,
    summary: args.summary,
    status: (args.status as any) ?? "open",
    runId: ctx.runId ?? undefined,
    metadata: args.metadata,
  });

  if (ctx.workspaceId) {
    logWorkspaceActivity({
      workspaceId: ctx.workspaceId,
      type: "review",
      title: args.title,
      summary: args.summary,
      refId: reviewId,
    });
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ reviewId }) }],
  };
}

export async function handleSaveFinding(
  args: SaveFindingArgs,
  ctx: MainsToolContext,
) {
  const findingId = await workspaceService.createFinding({
    reviewId: args.reviewId,
    severity: args.severity as any,
    file: args.file,
    lineStart: args.lineStart,
    lineEnd: args.lineEnd,
    message: args.message,
    reason: args.reason,
    suggestion: args.suggestion,
    metadata: args.metadata,
  });

  if (ctx.workspaceId) {
    logWorkspaceActivity({
      workspaceId: ctx.workspaceId,
      type: "finding",
      title: `Finding in ${args.file}`,
      summary: args.message,
      refId: findingId,
      metadata: {
        severity: args.severity,
        file: args.file,
        reason: args.reason,
        lineStart: args.lineStart,
        lineEnd: args.lineEnd,
        hasSuggestion: !!args.suggestion,
      },
    });
    emitFindingsChanged(ctx.workspaceId);
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ findingId }) }],
  };
}

export async function handleSaveFindings(
  args: SaveFindingsArgs,
  ctx: MainsToolContext,
) {
  const findingIds = await workspaceService.createManyFindings(
    args.findings.map((f) => ({
      reviewId: args.reviewId,
      severity: f.severity as any,
      file: f.file,
      lineStart: f.lineStart,
      lineEnd: f.lineEnd,
      message: f.message,
      reason: f.reason,
      suggestion: f.suggestion,
      metadata: f.metadata,
    })),
  );

  if (ctx.workspaceId) {
    logWorkspaceActivity({
      workspaceId: ctx.workspaceId,
      type: "finding",
      title: `${args.findings.length} finding${args.findings.length === 1 ? "" : "s"} saved`,
      refId: args.reviewId,
      metadata: {
        count: args.findings.length,
        critical: args.findings.filter((f) => f.severity === "critical")
          .length,
        warning: args.findings.filter((f) => f.severity === "warning")
          .length,
        info: args.findings.filter((f) => f.severity === "info").length,
      },
    });
    emitFindingsChanged(ctx.workspaceId);
  }

  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ findingIds }) },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// CheckPackage handler
// ─────────────────────────────────────────────────────────────

export async function handleCheckPackage(
  args: CheckPackageArgs,
  _ctx: MainsToolContext,
) {
  const { guardsService } = await import("../../guards/guards.service");

  if (!args.packages || args.packages.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No packages provided to check." }],
      isError: true,
    };
  }

  const pkgs = args.packages.map((p) => ({
    name: p.name,
    version: p.version,
    ecosystem: (p.ecosystem || "npm") as any,
  }));

  let checks;
  try {
    checks = await guardsService.checkPackages(pkgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Guard check failed: ${message}` }],
      isError: true,
    };
  }

  const lines: string[] = [];
  let hasBlocked = false;

  for (const r of checks) {
    const status = r.allowed ? "✅ ALLOWED" : "❌ BLOCKED";
    if (!r.allowed) hasBlocked = true;

    const scorePart = r.score
      ? ` | score: ${(r.score.overallScore * 100).toFixed(0)}/100 (quality=${r.score.categories.quality ?? "-"}, vulnerability=${r.score.categories.vulnerability ?? "-"}, supplyChain=${r.score.categories.supplyChain ?? "-"})`
      : "";
    const alertPart = r.alerts.length > 0
      ? ` | alerts: ${r.alerts.map((a) => `${a.severity}: ${a.title}`).join(", ")}`
      : "";
    const reasonPart = r.reason ? ` | ${r.reason}` : "";

    lines.push(`${status} ${r.package.name}${scorePart}${alertPart}${reasonPart}`);
  }

  if (hasBlocked) {
    lines.push("\n⚠️ One or more packages were BLOCKED. Do NOT install blocked packages. Inform the user about the security risks.");
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
