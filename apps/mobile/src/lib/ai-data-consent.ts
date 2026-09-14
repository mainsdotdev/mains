import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { aiDataConsents } from "@/db/schema";
import {
  PROVIDER_IDS,
  SUPPORTED_PROVIDER_IDS,
  type ProviderId,
} from "@mains/contracts/provider-ids";

/** Bump when the data categories or recipient wording materially changes. */
export const AI_DATA_DISCLOSURE_VERSION = 1;

export interface AiProviderDisclosure {
  providerId: ProviderId;
  serviceName: string;
  recipientName: string;
  recipientDetail: string;
  privacyPolicyUrl: string;
}

const DISCLOSURES: Record<ProviderId, AiProviderDisclosure> = {
  [PROVIDER_IDS.codex]: {
    providerId: PROVIDER_IDS.codex,
    serviceName: "Codex",
    recipientName: "OpenAI",
    recipientDetail: "OpenAI processes the data through Codex.",
    privacyPolicyUrl: "https://openai.com/policies/privacy-policy/",
  },
  [PROVIDER_IDS.claude]: {
    providerId: PROVIDER_IDS.claude,
    serviceName: "Claude Code",
    recipientName: "Anthropic",
    recipientDetail: "Anthropic processes the data through Claude Code.",
    privacyPolicyUrl: "https://www.anthropic.com/legal/privacy",
  },
  [PROVIDER_IDS.copilot]: {
    providerId: PROVIDER_IDS.copilot,
    serviceName: "GitHub Copilot",
    recipientName: "GitHub Copilot",
    recipientDetail:
      "GitHub processes the data through Copilot and may route it to the model provider selected by Copilot.",
    privacyPolicyUrl:
      "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
  },
  [PROVIDER_IDS.cursor]: {
    providerId: PROVIDER_IDS.cursor,
    serviceName: "Cursor",
    recipientName: "Cursor",
    recipientDetail:
      "Anysphere processes the data through Cursor and may route it to the model provider selected by Cursor.",
    privacyPolicyUrl: "https://cursor.com/privacy",
  },
};

export const AI_PROVIDER_DISCLOSURES = SUPPORTED_PROVIDER_IDS.map(
  (providerId) => DISCLOSURES[providerId],
);

export function aiProviderDisclosure(providerId: string): AiProviderDisclosure | null {
  return DISCLOSURES[providerId as ProviderId] ?? null;
}

export function hasAiDataConsent(backendId: string, providerId: string): boolean {
  const consent = db
    .select({ disclosureVersion: aiDataConsents.disclosureVersion })
    .from(aiDataConsents)
    .where(
      and(
        eq(aiDataConsents.backendId, backendId),
        eq(aiDataConsents.providerId, providerId),
      ),
    )
    .get();
  return consent?.disclosureVersion === AI_DATA_DISCLOSURE_VERSION;
}

export function grantAiDataConsent(backendId: string, providerId: string): void {
  db.insert(aiDataConsents)
    .values({
      backendId,
      providerId,
      disclosureVersion: AI_DATA_DISCLOSURE_VERSION,
      acceptedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [aiDataConsents.backendId, aiDataConsents.providerId],
      set: {
        disclosureVersion: AI_DATA_DISCLOSURE_VERSION,
        acceptedAt: new Date(),
      },
    })
    .run();
}

export function revokeAiDataConsent(backendId: string, providerId: string): void {
  db.delete(aiDataConsents)
    .where(
      and(
        eq(aiDataConsents.backendId, backendId),
        eq(aiDataConsents.providerId, providerId),
      ),
    )
    .run();
}

export function revokeAllAiDataConsents(backendId: string): void {
  db.delete(aiDataConsents).where(eq(aiDataConsents.backendId, backendId)).run();
}

export function missingAiDataConsentMessage(providerId: string): string {
  const disclosure = aiProviderDisclosure(providerId);
  return disclosure
    ? `Allow data sharing with ${disclosure.recipientName} before sending.`
    : `Mains has no data-sharing disclosure for provider “${providerId}”.`;
}
