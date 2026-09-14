/** Seed agent spaces shown in welcome + filtered onboarding provider steps */
export const ONBOARDING_AGENT_SLUGS = [
  "claude",
  "copilot",
  "codex",
  "cursor",
] as const;

export type OnboardingAgentSlug = (typeof ONBOARDING_AGENT_SLUGS)[number];

export function isOnboardingAgentSlug(
  slug: string | null | undefined,
): slug is OnboardingAgentSlug {
  return (
    slug != null &&
    (ONBOARDING_AGENT_SLUGS as readonly string[]).includes(slug)
  );
}
