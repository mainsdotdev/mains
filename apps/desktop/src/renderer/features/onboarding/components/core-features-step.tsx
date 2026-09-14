import { Body, Heading1, Text } from "@/components/ui";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { CORE_FEATURES } from "../onboarding-features";
import { FeatureCard } from "./feature-card";

/**
 * "Out of the box" tour: a sticky intro column on the left and a scrolling
 * two-column grid of feature cards on the right. Pure presentation — it
 * changes no settings, so the screen's "you can change this later" note
 * stays hidden here.
 */
export function CoreFeaturesStep() {
  const prefersReducedMotion = usePrefersReducedMotion();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-12">
      <aside className="sticky top-0 flex w-80 shrink-0 flex-col justify-center self-start pt-24">
        <Text
          as="span"
          size="xs"
          weight="medium"
          className="w-fit rounded-full glass-outline px-2.5 py-1 text-primary-700  dark:text-primary"
        >
          A quick tour
        </Text>
        <Heading1 className="mt-4 font-mono tracking-tight">
          Built to run agents
        </Heading1>
        <Body className="mt-3">
          Everything on this page is already set up. Have a look, then start
          your first run.
        </Body>
      </aside>

      <div className="grid min-w-0 flex-1 grid-cols-2 gap-6">
        {CORE_FEATURES.map((feature, index) => (
          <FeatureCard
            key={feature.id}
            feature={feature}
            index={index}
            animate={!prefersReducedMotion}
          />
        ))}
      </div>
    </div>
  );
}
