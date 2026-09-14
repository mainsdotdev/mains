/**
 * Single source-of-truth for provider mode lists used in both settings UI
 * (long descriptions) and workspace toolbars (short labels). When you need
 * to add or rename a mode, change it here — both surfaces pick it up.
 */

import type { ClaudePermissionMode } from "../../shared/claude-permission-modes";

export interface ModeOption<TValue extends string = string> {
  value: TValue;
  /** Long form, e.g. "Workspace Write" — used in settings rows */
  label: string;
  /** Short form, e.g. "Write" — used in toolbar pill */
  shortLabel: string;
  /** Description shown under the label in dropdowns */
  description: string;
}

// ── Claude permission mode ─────────────────────────────────────────
// Values and the install default live in `shared/claude-permission-modes`,
// since main needs them too; only the copy is a renderer concern.

export const CLAUDE_PERMISSION_MODES: readonly ModeOption<ClaudePermissionMode>[] = [
  {
    value: "default",
    label: "Ask permissions",
    shortLabel: "Ask",
    description: "Ask before changes",
  },
  {
    value: "auto",
    label: "Auto",
    shortLabel: "Auto",
    description: "Claude decides when to ask",
  },
  {
    value: "acceptEdits",
    label: "Auto accept edits",
    shortLabel: "Edit",
    description: "Accept all edits",
  },
  {
    value: "plan",
    label: "Plan mode",
    shortLabel: "Plan",
    description: "Plan before changes",
  },
  {
    value: "bypassPermissions",
    label: "Bypass permissions",
    shortLabel: "Bypass",
    description: "Bypass all permissions",
  },
  {
    value: "dontAsk",
    label: "Don't ask",
    shortLabel: "Don't Ask",
    description: "Deny unapproved tools silently",
  },
] as const;

// ── Cursor mode (ask / agent / plan) ───────────────────────────────
export type CursorMode = "ask" | "agent" | "plan";

export const CURSOR_MODES: readonly ModeOption<CursorMode>[] = [
  {
    value: "ask",
    label: "Ask",
    shortLabel: "Ask",
    description: "Ask before changes",
  },
  {
    value: "agent",
    label: "Agent",
    shortLabel: "Agent",
    description: "Full autonomous agent mode",
  },
  {
    value: "plan",
    label: "Plan",
    shortLabel: "Plan",
    description: "Plan before executing",
  },
] as const;

// ── Codex sandbox mode ─────────────────────────────────────────────
export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export const CODEX_SANDBOX_MODES: readonly ModeOption<CodexSandboxMode>[] = [
  {
    value: "read-only",
    label: "Read Only",
    shortLabel: "Read Only",
    description: "Agent cannot modify files",
  },
  {
    value: "workspace-write",
    label: "Workspace Write",
    shortLabel: "Write",
    description: "Write within workspace only",
  },
  {
    value: "danger-full-access",
    label: "Full Access",
    shortLabel: "Full Access",
    description: "No restrictions",
  },
] as const;

/** Derive `{ value → shortLabel }` map for toolbar pills */
export function shortLabelMap<T extends string>(
  modes: readonly ModeOption<T>[],
): Record<string, string> {
  return Object.fromEntries(modes.map((m) => [m.value, m.shortLabel]));
}
