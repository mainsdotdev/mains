// ─────────────────────────────────────────────────────────────
// Default Spaces Seed Data
// ─────────────────────────────────────────────────────────────

import { PROVIDER_IDS, type ProviderId } from "../../../shared/provider-ids";
import type { ModeId } from "../../../shared/modes";

export interface SeedSpace {
  id: string;
  name: string;
  slug: string;
  icon: string;
  systemPrompt: string;
  themeConfig: {
    lightBackground: string;
    darkBackground: string;
  };
  providerId: ProviderId;
  mode: ModeId;
  sortOrder: number;
}

export const seedSpaces: SeedSpace[] = [
  {
    id: "claude",
    name: "Claude",
    slug: "claude",
    icon: "icon:claude",
    systemPrompt: "",
    themeConfig: {
      lightBackground: "#ffffffb3",
      darkBackground: "#00000070",
    },
    providerId: PROVIDER_IDS.claude,
    mode: "developer",
    sortOrder: 0,
  },

  {
    id: "codex",
    name: "Codex",
    slug: "codex",
    icon: "icon:codex",
    systemPrompt: "",
    themeConfig: {
      lightBackground: "#ffffffb3",
      darkBackground: "#00000070",
    },
    providerId: PROVIDER_IDS.codex,
    mode: "developer",
    sortOrder: 1,
  },
  {
    id: "copilot",
    name: "Copilot",
    slug: "copilot",
    icon: "icon:copilot",
    systemPrompt: "",
    themeConfig: {
      lightBackground: "#ffffffb3",
      darkBackground: "#00000070",
    },
    providerId: PROVIDER_IDS.copilot,
    mode: "developer",
    sortOrder: 2,
  },
  {
    id: "cursor",
    name: "Cursor",
    slug: "cursor",
    icon: "icon:cursor",
    systemPrompt: "",
    themeConfig: {
      lightBackground: "#ffffffb3",
      darkBackground: "#00000070",
    },
    providerId: PROVIDER_IDS.cursor,
    mode: "developer",
    sortOrder: 3,
  },
];
