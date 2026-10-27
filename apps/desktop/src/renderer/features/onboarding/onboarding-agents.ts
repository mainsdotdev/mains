import { SEEDED_SPACE_IDS, isSeededSpaceId, type SeededSpaceId } from "@mains/contracts/spaces";

/** Seed agent identities; editable names and slugs never select a Space. */
export const ONBOARDING_AGENT_IDS = SEEDED_SPACE_IDS;
export type OnboardingAgentId = SeededSpaceId;
export const isOnboardingAgentId = isSeededSpaceId;
