import type { CreateProviderPayload } from "../../modules/providers/providers.dto";
import { DEFAULT_CLAUDE_PERMISSION_MODE } from "../../../shared/claude-permission-modes";
import { PROVIDER_IDS } from "../../../shared/provider-ids";

// `defaultModel` is deliberately unset on every provider below. It is a *user*
// preference (an id the user pinned), not a catalog fact: each agent CLI rotates
// its models every few months, so a hardcoded id here silently stops matching
// the live `listModels()` output and leaves the picker with no default at all.
// Each driver resolves its own default from the live catalog instead — see
// `resolveCatalogDefaultId` in adapter.shared.ts.
export const seedProviders: CreateProviderPayload[] = [

  {
    id: PROVIDER_IDS.copilot,
    kind: "agent_runtime",
    displayName: "GitHub Copilot (CLI/SDK)",
    isEnabled: true,
    config: {
      transport: "stdio" as const,
      timeout: 3_600_000,
      logLevel: "info" as const,
      autoRestart: false,
    },
    capabilities: {
      mode: ["run"],
      streaming: true,
      workspaceAware: true,
      artifacts: ["patch", "file", "log", "command_result"],
      notes: "Code-writing runs via Copilot SDK + Copilot CLI server mode",
    },
  },

  {
    id: PROVIDER_IDS.claude,
    kind: "agent_runtime",
    displayName: "Claude Code (Local Agent)",
    isEnabled: true,
    config: {
      timeout: 3_600_000,
      apiKey: process.env.ANTHROPIC_API_KEY,
      permissionMode: DEFAULT_CLAUDE_PERMISSION_MODE,
      // Claude couples thinking to the effort level, so both are seeded
      // together — the renderer clamps the level to whatever the selected
      // model advertises.
      thinkingMode: true,
      effortLevel: "medium",
    },
    capabilities: {
      mode: ["run"],
      tools: true,
      streaming: true,
      workspaceAware: true,
      artifacts: ["patch", "file", "log", "command_result"],
      notes: "Claude Code adapter using Anthropic SDK",
    },
  },

  {
    id: PROVIDER_IDS.codex,
    kind: "agent_runtime",
    displayName: "OpenAI Codex (CLI/SDK)",
    isEnabled: true,
    config: {
      timeout: 3_600_000,
      approvalMode: "on-request",
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
      webSearchMode: "live",
      personality: "none",
      modelReasoningEffort: "medium",
    },
    capabilities: {
      mode: ["run"],
      tools: true,
      streaming: true,
      workspaceAware: true,
      artifacts: ["patch", "file", "log", "command_result"],
      notes: "OpenAI Codex adapter using @openai/codex-sdk",
    },
  },

  {
    id: PROVIDER_IDS.cursor,
    kind: "agent_runtime",
    displayName: "Cursor (ACP/CLI)",
    isEnabled: true,
    // No effort seeded: Cursor and Copilot both default to their "auto" model,
    // which advertises no reasoning-effort levels at all.
    config: {
      timeout: 600000,
      mode: "agent",
    },
    capabilities: {
      mode: ["run"],
      tools: true,
      streaming: true,
      workspaceAware: true,
      artifacts: ["patch", "file", "log", "command_result"],
      notes: "Cursor adapter using ACP (Agent Client Protocol) over JSON-RPC",
    },
  },
];
