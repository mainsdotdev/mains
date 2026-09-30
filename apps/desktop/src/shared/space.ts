import type { ProviderId } from "@mains/contracts/provider-ids";
import type { ModeId } from "@mains/contracts/modes";

/** Space record shared by the renderer API and the floating browser chat context. */
export interface Space {
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
  sortOrder: number;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}
