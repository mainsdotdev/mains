export type ProviderCliSource = "bundled" | "configured";

/** Metadata for the executable the provider actually uses. */
export interface ProviderCliInfo {
  version: string | null;
  channel: string | null;
  outdated: boolean;
  compatibility?: "supported" | "newer" | "unsupported" | "unknown";
  minimumVersion?: string;
  testedProtocolVersion?: string;
  source?: ProviderCliSource;
  updateMethod?: "app" | "cli";
  /** Shell-quoted command for signing in through this executable. */
  authLoginCommand?: string;
}

/** Availability on the backend, including Mains' bundled Claude runtime. */
export interface DetectedClis {
  claude: boolean;
  copilot: boolean;
  codex: boolean;
  cursor: boolean;
  claudeSource?: ProviderCliSource;
}
