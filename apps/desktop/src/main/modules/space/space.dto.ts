// ─────────────────────────────────────────────────────────────
// Space Payload Types
// ─────────────────────────────────────────────────────────────
import type { ProviderId } from "../../../shared/provider-ids";
import type { ModeId } from "../../../shared/modes";

export interface SpacePayload {
  name: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
  model?: string;
  icon?: string;
  themeConfig?: string;
  providerId?: ProviderId;
  mode?: ModeId;
  sortOrder?: number;
}

export interface SanitizedSpaceResult {
  data: Partial<SpacePayload>;
  errors: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────
// Response Types
// ─────────────────────────────────────────────────────────────
export interface SpaceRecord {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  description: string | null;
  systemPrompt: string | null;
  model: string | null;
  icon: string | null;
  themeConfig: string | null;
  providerId: ProviderId;
  mode: ModeId;
  sortOrder: number | null;
  isArchived: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

