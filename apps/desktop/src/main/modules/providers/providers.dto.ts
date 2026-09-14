// ─────────────────────────────────────────────────────────────
// Provider DTOs
// ─────────────────────────────────────────────────────────────

export type ProviderKind = "llm_runtime" | "agent_runtime";

export interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
  [key: string]: unknown;
}

export interface ProviderCapabilities {
  streaming?: boolean;
  functionCalling?: boolean;
  vision?: boolean;
  embeddings?: boolean;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Create / Update Payloads
// ─────────────────────────────────────────────────────────────
export interface CreateProviderPayload {
  id: string;
  kind: ProviderKind;
  displayName: string;
  isEnabled?: boolean;
  config?: ProviderConfig;
  capabilities?: ProviderCapabilities;
  defaultModel?: string;
}

export interface UpdateProviderPayload {
  displayName?: string;
  isEnabled?: boolean;
  config?: ProviderConfig;
  capabilities?: ProviderCapabilities;
  defaultModel?: string;
}

/**
 * `providers:updateRunSettings` — the settings the composer's toolbar edits,
 * as a patch: only the keys present change. `effortLevel` is a level from
 * `EFFORT_LEVELS` or "" for reasoning off; `permissionMode` is one of the
 * provider's ids (`shared/run-settings.ts`); `goalMode` / `planMode` are
 * Codex-only.
 */
export interface UpdateRunSettingsPayload {
  effortLevel?: string;
  permissionMode?: string;
  fastMode?: boolean;
  goalMode?: boolean;
  planMode?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Response Types
// ─────────────────────────────────────────────────────────────
export interface ProviderResponse {
  id: string;
  kind: ProviderKind;
  displayName: string;
  isEnabled: boolean;
  config: ProviderConfig | null;
  capabilities: ProviderCapabilities | null;
  defaultModel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderListResponse {
  providers: ProviderResponse[];
  total: number;
}


// ─────────────────────────────────────────────────────────────
// CLI Detection
// ─────────────────────────────────────────────────────────────
export interface DetectedClisResponse {
  claude: boolean;
  copilot: boolean;
  codex: boolean;
  cursor: boolean;
}
