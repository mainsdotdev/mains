/**
 * Mode harness — everything a mode contributes to a run: a prompt delta, a
 * tool policy, and per-provider config defaults/overrides. The prompt-layer
 * and policy half of a mode (`src/shared/modes.ts`); the UI half lives in the
 * renderer's MODE_CONFIGS.
 *
 * Resolution happens once, in runs.service, when a run starts or resumes;
 * drivers receive the resolved values on the per-run request
 * (`extraInstructions`, `toolPolicy`, `configSnapshot`) and apply them through
 * their provider's native mechanism (codex: `developerInstructions` +
 * sandbox; claude: system-prompt preset append + tool lists; copilot:
 * systemMessage + tool hook; cursor: prompt prefix + agent mode). Drivers
 * never branch on the mode itself, and the harness never rides
 * `AdapterConfig` — adapters are cached per provider and shared across
 * concurrent spaces, so per-mode state there would race.
 *
 * Mains-tool availability per mode is NOT decided here: the tool registry
 * (`mains-tools.registry.ts`) carries a per-tool `modes` allowlist, so a tool
 * a mode excludes is never registered with the provider in the first place.
 */

import type { ModeId } from "./modes";
import { DEFAULT_MODE_ID } from "./modes";
import { PROVIDER_IDS, type ProviderId } from "./provider-ids";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Tool policy for drivers with an allowlist mechanism (claude, copilot).
 * The effective set a driver applies is `(allowedTools ?? provider default)
 * minus disallowedTools` — computed driver-side, since the default list is an
 * adapter concern. Codex and cursor have no allowlist; their harness rides
 * `configSnapshot` (sandbox / agent mode) instead.
 *
 * A type alias, not an interface, so it stays assignable to the
 * `Record<string, unknown>` snapshot columns it is persisted into.
 */
export type ModeToolPolicy = {
  /** Replaces the provider's default allowlist. null = provider default. */
  allowedTools: readonly string[] | null;
  /** Hard-denied tools: claude `disallowedTools`, copilot pre-hook deny. */
  disallowedTools: readonly string[];
};

export interface ModeHarnessDescriptor {
  mode: ModeId;
  /** Prompt delta attached via each provider's native prompt layer. null = none. */
  promptDelta: string | null;
  /** null = provider defaults untouched (developer). */
  toolPolicy: ModeToolPolicy | null;
  /** configSnapshot keys merged UNDER the caller's snapshot (caller wins). */
  configDefaults: Partial<Record<ProviderId, Record<string, unknown>>>;
  /**
   * configSnapshot keys merged OVER the caller's snapshot. Mode-critical
   * settings only — a stale client asking a chat space for
   * `bypassPermissions` must not win.
   */
  configOverrides: Partial<Record<ProviderId, Record<string, unknown>>>;
}

// ─────────────────────────────────────────────────────────────
// Prompt deltas
// ─────────────────────────────────────────────────────────────

/**
 * Work mode: same agent, non-technical collaboration contract. Modeled on the
 * delta OpenAI's desktop app injects for "Codex for Work" — tone + deliverable
 * rules only, deliberately small.
 */
const WORK_INSTRUCTIONS = `# Working with a non-technical user

You are assisting with knowledge work rather than software development. The user may not be technical.

- Prefer non-technical language. Don't name the commands or tools you run — describe what they do in plain terms (say "scanning the folder for documents", not "running grep").
- The user is not reading your tool calls. When a step produces something they asked about, carry the answer into your reply rather than pointing at the step that produced it.
- Say what you did and why in concrete terms, and match the length of the reply to the size of the task — a small request gets a couple of sentences, not a structured report.
- If you could not do something — a tool you don't have, a step you can't run — say so plainly instead of quietly working around it.
- You do have the web: WebSearch and WebFetch are available and authorized in this session, wherever the user is. When they ask for anything current or online — news, prices, schedules, what a page says — search or fetch it rather than answering from memory or saying you have no internet access.
- If the user asks for technical detail, or it would genuinely help them fix a problem, you may switch to technical language.

# Deliverables

- Finish work into concrete files the user can open, share, or reuse (documents, reports, summaries). Save them inside the working directory and tell the user where they are.
- Prefer polished, complete outputs over fragments in chat: when the user asks for a report, the file is the deliverable and your reply summarizes it.`;

/**
 * Chat mode: plain conversation. Read-only by contract —
 * and mechanically where the provider allows (claude/copilot tool policy,
 * codex read-only sandbox, cursor "ask" mode).
 */
const CHAT_INSTRUCTIONS = `# Conversation, not modification

You are chatting with the user — answering questions and thinking through problems. This session is read-only.

- Never modify files, run commands, or change any state, even when asked. If the user wants changes made, explain that this is a chat space and suggest switching to a Code or Work space.
- You may read attached context or search the web to ground your answers.
- Your reply is the deliverable: answer fully in chat rather than producing files.
- Match the shape of the answer to the question. A simple question gets a short, direct answer rather than a structured report; for casual conversation, just talk.`;

// ─────────────────────────────────────────────────────────────
// The table
// ─────────────────────────────────────────────────────────────

export const MODE_HARNESSES: Record<ModeId, ModeHarnessDescriptor> = {
  // Developer is the current behavior, locked to all-null/empty: drivers take
  // their existing paths untouched.
  developer: {
    mode: "developer",
    promptDelta: null,
    toolPolicy: null,
    configDefaults: {},
    configOverrides: {},
  },
  // Work: file tools stay, Bash goes, git ceremony goes (the git/PR mains
  // tools disappear via the registry's modes allowlist). acceptEdits is a
  // default, not an override — an explicit caller choice still wins. Codex's
  // `personality` carries the tone half of this mode natively: its templates
  // land at the top of codex's own instructions, above anything a prompt delta
  // can reach.
  //
  // Plan mode is pinned OFF as an override: the toggle lives in the
  // developer-only permission dropdown, so the work composer has no way to
  // turn it back off, and the flag sits on the shared provider row — a Code
  // space that left it on would otherwise plan every work run too.
  work: {
    mode: "work",
    promptDelta: WORK_INSTRUCTIONS,
    toolPolicy: {
      allowedTools: null,
      disallowedTools: ["Bash"],
    },
    configDefaults: {
      [PROVIDER_IDS.claude]: { permissionMode: "acceptEdits" },
      [PROVIDER_IDS.copilot]: { permissionMode: "acceptEdits" },
      [PROVIDER_IDS.codex]: {
        sandboxMode: "workspace-write",
        personality: "friendly",
      },
      [PROVIDER_IDS.cursor]: { mode: "agent" },
    },
    configOverrides: {
      [PROVIDER_IDS.codex]: { planMode: false },
    },
  },
  // Chat: read-only, enforced. Overrides beat the caller's snapshot so no
  // client can escalate a chat space into a writing one. Plan and goal are
  // both developer-side affordances riding the shared provider row (see
  // work), so chat pins both off — a goal would have codex set a thread
  // objective for a conversation that has no controls to manage it.
  chat: {
    mode: "chat",
    promptDelta: CHAT_INSTRUCTIONS,
    toolPolicy: {
      allowedTools: ["Read", "Glob", "Grep", "LSP", "WebFetch", "WebSearch"],
      disallowedTools: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "Task"],
    },
    configDefaults: {
      [PROVIDER_IDS.codex]: { personality: "friendly" },
    },
    configOverrides: {
      [PROVIDER_IDS.claude]: { permissionMode: "default" },
      [PROVIDER_IDS.copilot]: { permissionMode: "default" },
      [PROVIDER_IDS.codex]: {
        sandboxMode: "read-only",
        planMode: false,
        goalMode: false,
      },
      [PROVIDER_IDS.cursor]: { mode: "ask" },
    },
  },
};

export function getModeHarness(mode: ModeId | null | undefined): ModeHarnessDescriptor {
  return MODE_HARNESSES[mode ?? DEFAULT_MODE_ID] ?? MODE_HARNESSES[DEFAULT_MODE_ID];
}

/**
 * The value a mode pins for one provider setting, or undefined when the mode
 * leaves it to the provider's own config. Overrides first, then defaults —
 * matching `composeConfigSnapshot`'s precedence minus the caller payload.
 *
 * Exists so a UI can ask "does this mode decide this for me?" without
 * re-listing the table: a settings control the harness pins is not a control,
 * and a second list of pinned keys would drift from this one.
 */
export function modeProviderSetting(
  mode: ModeId | null | undefined,
  providerId: ProviderId,
  key: string,
): unknown {
  const harness = getModeHarness(mode);
  return (
    harness.configOverrides[providerId]?.[key] ??
    harness.configDefaults[providerId]?.[key]
  );
}

// ─────────────────────────────────────────────────────────────
// Composition — called once per run in runs.service
// ─────────────────────────────────────────────────────────────

/**
 * The instruction text a run carries: the mode's delta first, then the
 * space's custom system prompt. null when both are absent.
 */
export function composeExtraInstructions(
  mode: ModeId | null | undefined,
  spaceSystemPrompt?: string | null,
): string | null {
  const delta = getModeHarness(mode).promptDelta;
  const custom = spaceSystemPrompt?.trim() || null;
  const parts = [delta, custom].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function parseToolPolicySnapshot(snapshot: unknown): ModeToolPolicy | null {
  if (snapshot == null) return null;
  if (typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Invalid tool policy snapshot");
  }

  const candidate = snapshot as Record<string, unknown>;
  const allowedValue = candidate.allowedTools;
  const disallowedValue = candidate.disallowedTools;

  if (
    allowedValue !== undefined &&
    allowedValue !== null &&
    (!Array.isArray(allowedValue) ||
      allowedValue.some(
        (tool) => typeof tool !== "string" || tool.trim().length === 0,
      ))
  ) {
    throw new Error("Invalid tool policy allowedTools");
  }
  if (
    disallowedValue !== undefined &&
    (!Array.isArray(disallowedValue) ||
      disallowedValue.some(
        (tool) => typeof tool !== "string" || tool.trim().length === 0,
      ))
  ) {
    throw new Error("Invalid tool policy disallowedTools");
  }

  const allowedTools =
    allowedValue == null
      ? null
      : [...new Set(allowedValue as string[])];
  const disallowedTools = [
    ...new Set((disallowedValue ?? []) as string[]),
  ];

  // An absent/null allowlist plus no denials contributes no restriction.
  return allowedTools === null && disallowedTools.length === 0
    ? null
    : { allowedTools, disallowedTools };
}

/**
 * The tool policy a run carries. Permissions compose restrictively:
 * hard denials accumulate, while every non-null allowlist narrows the result.
 *
 * A caller may make a mode stricter, but can never loosen what the mode
 * restricts: the mode's denials survive, and where the mode sets an allowlist
 * it bounds the result. Where it sets none (developer, work), the caller's
 * allowlist still replaces the provider's default list — "stricter" is
 * measured against the mode, not against that default.
 */
export function composeToolPolicy(
  mode: ModeId | null | undefined,
  payloadSnapshot?: unknown,
): ModeToolPolicy | null {
  const harnessPolicy = getModeHarness(mode).toolPolicy;
  const callerPolicy = parseToolPolicySnapshot(payloadSnapshot);

  if (!harnessPolicy && !callerPolicy) return null;

  const disallowedTools = [
    ...new Set([
      ...(harnessPolicy?.disallowedTools ?? []),
      ...(callerPolicy?.disallowedTools ?? []),
    ]),
  ];
  const harnessAllowed = harnessPolicy?.allowedTools ?? null;
  const callerAllowed = callerPolicy?.allowedTools ?? null;

  let allowedTools: string[] | null;
  if (harnessAllowed && callerAllowed) {
    const callerSet = new Set(callerAllowed);
    allowedTools = harnessAllowed.filter((tool) => callerSet.has(tool));
  } else if (harnessAllowed) {
    allowedTools = [...harnessAllowed];
  } else if (callerAllowed) {
    allowedTools = [...callerAllowed];
  } else {
    allowedTools = null;
  }

  return { allowedTools, disallowedTools };
}

/**
 * The config snapshot a run carries: mode defaults under the caller's
 * snapshot, mode overrides on top (`overrides > payload > defaults`).
 * null when the result is empty, matching the "no snapshot" wire shape.
 */
export function composeConfigSnapshot(
  mode: ModeId | null | undefined,
  providerId: string,
  payloadSnapshot?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const harness = getModeHarness(mode);
  const defaults = harness.configDefaults[providerId as ProviderId] ?? {};
  const overrides = harness.configOverrides[providerId as ProviderId] ?? {};
  const merged = { ...defaults, ...(payloadSnapshot ?? {}), ...overrides };
  return Object.keys(merged).length > 0 ? merged : null;
}
