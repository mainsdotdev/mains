import { getProviderVariant } from "@/lib/provider-variants";
import { ONBOARDING_AGENT_SLUGS } from "../onboarding-agents";

export function WelcomeIntroStep() {
  return (
    <div className="onboarding-welcome" aria-hidden="true">
      <div className="onboarding-welcome-orbit" />
      <div className="onboarding-welcome-orbit onboarding-welcome-orbit-inner" />
      <div className="onboarding-welcome-mark glass-outline">
        <img
          src={"./icon-no-bg.png"}
          alt={"Mains"}
          width={256}
          height={256}
          className="h-20 w-auto  object-cover"
        />
      </div>
      <div className="onboarding-welcome-providers">
        {ONBOARDING_AGENT_SLUGS.map((variant) => {
          const provider = getProviderVariant(variant);
          const Icon = provider.icon;
          return (
            <span key={variant} className="glass-outline">
              <Icon className={`size-5 `} />
            </span>
          );
        })}
      </div>
      <span className="onboarding-welcome-caption">
        All your agents.
        <br />A space of your own.
      </span>
    </div>
  );
}
