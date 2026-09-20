import type { ToolApprovalRequest, ToolApprovalResponse } from "./runs.dto";

/**
 * What a desktop notification for a pending request looks like, and which
 * answers it can give without the app — pure, so the Electron wrapper in
 * `run-notifications.ts` stays a thin shell around it.
 *
 * How much a notification may settle on its own:
 *  - `approve` — a plain tool permission: Allow / Deny buttons.
 *  - `choose`  — a single-choice question: one button per option.
 *  - `reply`   — an open question: the macOS inline reply field.
 *  - `open`    — anything that needs the full dialog (the plan review, MCP
 *    forms, multi-select, secrets, long option lists): clicking opens the run.
 *
 * The plan review stays `open` on purpose: approving it in the app also moves
 * the provider's composer out of plan mode, which a notification can't do —
 * and a plan should be read before it is approved.
 */
export type ApprovalNotificationMode = "approve" | "choose" | "reply" | "open";

export interface ApprovalNotificationSpec {
  mode: ApprovalNotificationMode;
  title: string;
  subtitle?: string;
  body: string;
  /** Button labels in order; macOS shows the first as the primary action. */
  actions: string[];
  hasReply: boolean;
}

/** Something the user did on the notification itself (not a click on it). */
export type NotificationInteraction =
  | { type: "action"; index: number }
  | { type: "reply"; text: string };

/** More options than this don't fit a notification; the dialog shows them. */
const MAX_OPTION_ACTIONS = 4;
const MAX_BODY_CHARS = 200;
const MAX_SUBTITLE_CHARS = 80;

const APPROVE_ACTIONS = ["Allow", "Deny"];

function isPlanReview(toolName: string): boolean {
  return toolName.replace(/[_\s-]/g, "").toLowerCase() === "exitplanmode";
}

export function approvalNotificationMode(
  req: ToolApprovalRequest,
): ApprovalNotificationMode {
  if (req.kind === "tool_approval") {
    return isPlanReview(req.toolName) ? "open" : "approve";
  }
  if (req.kind !== "ask_user" || req.isSecret || req.multiSelect) return "open";
  const optionCount = req.options?.length ?? 0;
  if (optionCount === 0) return "reply";
  return optionCount <= MAX_OPTION_ACTIONS ? "choose" : "open";
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** `mcp__github__create_issue` → `create_issue (github)`; `[permission:shell]` → `shell permission`. */
function displayToolName(toolName: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (mcp) return `${mcp[2]} (${mcp[1]})`;
  const permission = /^\[permission:(.+)\]$/.exec(toolName);
  if (permission) return `${permission[1]} permission`;
  return toolName;
}

/**
 * A tool permission is headings only — the tool and, as subtitle, the run. The
 * call's input (a whole shell command, a diff) is noise in a banner; whoever
 * wants it opens the run. A question keeps its text: that is what its buttons
 * answer.
 */
function content(
  req: ToolApprovalRequest,
  mode: ApprovalNotificationMode,
): { title: string; body: string } {
  if (req.kind === "tool_approval") {
    return {
      title:
        mode === "open"
          ? "Plan ready for review"
          : `Allow ${displayToolName(req.toolName)}?`,
      body: "",
    };
  }
  if (req.kind === "elicitation") {
    return {
      title: `${req.serverName ?? displayToolName(req.toolName)} needs input`,
      body: req.question ?? req.description ?? "Open Mains to respond.",
    };
  }
  return {
    title: req.header ?? "The agent has a question",
    body: req.question ?? "Open Mains to answer.",
  };
}

export function describeApprovalNotification(
  req: ToolApprovalRequest,
  runLabel?: string | null,
): ApprovalNotificationSpec {
  const mode = approvalNotificationMode(req);
  const { title, body } = content(req, mode);
  const subtitle = runLabel?.trim() ? oneLine(runLabel, MAX_SUBTITLE_CHARS) : undefined;
  return {
    mode,
    title,
    ...(subtitle ? { subtitle } : {}),
    body: oneLine(body, MAX_BODY_CHARS),
    actions:
      mode === "approve"
        ? APPROVE_ACTIONS
        : mode === "choose"
          ? (req.options ?? []).map((option) => option.label)
          : [],
    hasReply: mode === "reply",
  };
}

/**
 * The broker response an interaction on the notification stands for, or null
 * when it answers nothing (an empty reply, an out-of-range button, a request
 * the notification can't settle) — the caller then opens the run instead.
 * Answers use the same shapes the in-app dialog sends.
 */
export function responseFromNotification(
  req: ToolApprovalRequest,
  interaction: NotificationInteraction,
): ToolApprovalResponse | null {
  const { requestId } = req;
  switch (approvalNotificationMode(req)) {
    case "approve":
      if (interaction.type !== "action") return null;
      if (interaction.index === 0) return { requestId, approved: true };
      if (interaction.index === 1) return { requestId, approved: false };
      return null;
    case "choose": {
      if (interaction.type !== "action") return null;
      const option = req.options?.[interaction.index];
      return option ? { requestId, approved: true, answer: option.label } : null;
    }
    case "reply": {
      if (interaction.type !== "reply") return null;
      const answer = interaction.text.trim();
      return answer ? { requestId, approved: true, answer } : null;
    }
    case "open":
      return null;
  }
}
