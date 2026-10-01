import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useIsPresent,
} from "motion/react";
import { MainLayout } from "@/components/layout/main";
import { Button } from "@/components/ui";
import { ChevronUp } from "@/components/ui/icons";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useCapabilities } from "@/lib/platform";
import {
  deriveThemeTokens,
  paintedPalette,
  resolveAppearance,
} from "@/lib/app-themes";
import {
  ONBOARDING_STEPS,
  useOnboarding,
  type OnboardingStepId,
} from "../hooks/use-onboarding";
import { AgentsStep } from "./agents-step";
import { ChoiceStep } from "./choice-step";
import { ThemeStep } from "./theme-step";
import { WelcomeIntroStep } from "./welcome-intro-step";
import { useOnboardingWindow } from "../hooks/use-onboarding-window";
import { prepareWorkspaceWindow } from "../lib/onboarding-completion";
import "../onboarding.css";

const COPY: Record<OnboardingStepId, { title: string; description: string }> = {
  welcome: {
    title: "Welcome to\nMains.",
    description:
      "A home for your ideas and the agents that bring them to life. Let’s make it yours.",
  },
  providers: {
    title: "Who’s on\nyour team?",
    description:
      "Choose the provider you’d like to start with. Your other agents will be here when you need them.",
  },
  theme: {
    title: "A little more\nyou.",
    description:
      "Find your colors. Set the mood. Make this a place you’ll love coming back to.",
  },
  worktrees: {
    title: "Stay where\nyou are?",
    description:
      "Use your current checkout for new coding sessions, or give each session a separate worktree.",
  },
  notifications: {
    title: "Know when\nit’s done.",
    description:
      "Get a desktop notification when your agent finishes a run.",
  },
  ready: {
    title: "All set.\nMake it happen.",
    description:
      "Your workspace is ready. A new idea is a good place to start.",
  },
};
const panelVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 22 }),
  visible: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -16 }),
};

function StepPanel({
  children,
  direction,
  reducedMotion,
}: {
  children: ReactNode;
  direction: number;
  reducedMotion: boolean;
}) {
  const isPresent = useIsPresent();
  return (
    <m.div
      className="onboarding-step-panel"
      inert={!isPresent}
      aria-hidden={!isPresent || undefined}
      custom={reducedMotion ? 0 : direction}
      variants={panelVariants}
      initial="enter"
      animate="visible"
      exit="exit"
      transition={{
        duration: reducedMotion ? 0.12 : 0.3,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </m.div>
  );
}

export function OnboardingScreen() {
  const { windowChrome } = useCapabilities();
  const reducedMotion = usePrefersReducedMotion();
  const frameRef = useRef<HTMLElement>(null);
  useOnboardingWindow(true);
  const flow = useOnboarding(() =>
    prepareWorkspaceWindow(frameRef.current, windowChrome, reducedMotion),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);
  const { goNext, goBack } = flow;
  const palette = paintedPalette(
    resolveAppearance(flow.palettes[flow.appearance], flow.appearance),
    flow.appearance,
  );
  const themeStyle = {
    ...deriveThemeTokens(palette, flow.appearance),
    "--onboarding-surface":
      flow.appearance === "dark"
        ? "var(--color-primary-950)"
        : "var(--color-primary)",
    "--onboarding-ink":
      flow.appearance === "dark"
        ? "var(--color-primary)"
        : "var(--color-primary-950)",
    "--onboarding-accent": "var(--color-accent)",
  } as CSSProperties;

  useEffect(() => {
    if (started.current) headingRef.current?.focus({ preventScroll: true });
    started.current = true;
  }, [flow.step]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat ||
        event.defaultPrevented
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "button, input, select, textarea, a, [contenteditable], fieldset",
        )
      )
        return;
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        goNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goBack]);

  let panel: ReactNode;
  switch (flow.step) {
    case "welcome":
      panel = <WelcomeIntroStep />;
      break;
    case "providers":
      panel = (
        <AgentsStep
          options={flow.options}
          value={flow.selectedProvider}
          onChange={flow.chooseProvider}
          isDetecting={flow.isDetecting}
          hasError={flow.providerError}
          onRecheck={flow.recheckProviders}
        />
      );
      break;
    case "theme":
      panel = (
        <ThemeStep
          theme={flow.theme}
          onThemeChange={flow.changeTheme}
          palettes={flow.palettes}
          appearance={flow.appearance}
          onPresetChange={flow.choosePreset}
          provider={flow.selectedProvider}
        />
      );
      break;
    case "worktrees":
      panel = (
        <ChoiceStep
          name="default-worktrees"
          label="Use the current checkout by default?"
          value={!flow.enableWorktrees}
          onChange={(useCurrentCheckout) =>
            flow.changeWorktrees(!useCurrentCheckout)
          }
          disabled={!flow.settingsReady}
          yes={{
            title: "Yes, use my current checkout.",
            description: "Start new sessions in my existing project folder.",
          }}
          no={{
            title: "No, use separate worktrees.",
            description: "Give each new session its own working copy.",
          }}
          note="Applies to new coding sessions in Git repositories."
        />
      );
      break;
    case "notifications":
      panel = (
        <ChoiceStep
          name="run-notifications"
          label="Notify when a run finishes?"
          value={flow.notifyOnRunComplete}
          onChange={flow.changeNotifications}
          disabled={!flow.settingsReady}
          yes={{
            title: "Yes, let me know.",
            description: "Notify me when my agent finishes.",
          }}
          no={{
            title: "No, I’ll check in.",
            description: "Keep run completion notifications off.",
          }}
          note="You can adjust notifications in Settings anytime."
        />
      );
      break;
    case "ready":
      panel = (
        <div className="onboarding-ready">
          <div
            className="onboarding-blank-card glass-outline"
            aria-label="Reserved card"
          />
        </div>
      );
      break;
  }

  return (
    <MainLayout>
      <LazyMotion features={domAnimation}>
        <main
          className="onboarding-root"
          inert={flow.isCompleting}
          data-native-window={windowChrome || undefined}
          style={themeStyle}
          data-appearance={flow.appearance}
          data-reduced-motion={reducedMotion || undefined}
          aria-label="Welcome to Mains"
        >
          <div
            className="onboarding-scene "
            style={
              {
                "--onboarding-gradient-accent": palette.accent,
                "--onboarding-gradient-surface": palette.background,
              } as CSSProperties
            }
          >
            <div className="onboarding-gradient" aria-hidden="true">
              <div />
              <div />
              <div />
            </div>
            <section
              ref={frameRef}
              className="onboarding-frame"
              aria-label="Set up your workspace"
              aria-busy={flow.isSaving}
            >
              <aside className="onboarding-copy">
                <div className="onboarding-navigation">
                  {flow.index > 0 ? (
                    <Button
                      variant="subtle"
                      className="onboarding-back"
                      onClick={flow.goBack}
                      disabled={flow.isSaving}
                    >
                      <ChevronUp className="size-3.5 -rotate-90" /> Back
                    </Button>
                  ) : (
                    <span className="onboarding-brand">
 
                    </span>
                  )}
                </div>
                <div className="onboarding-story">
                  <AnimatePresence
                    initial={false}
                    custom={reducedMotion ? 0 : flow.direction}
                  >
                    <StepPanel
                      key={flow.step}
                      direction={flow.direction}
                      reducedMotion={reducedMotion}
                    >
                      <h1 ref={headingRef} tabIndex={-1}>
                        {COPY[flow.step].title}
                      </h1>
                      <p>{COPY[flow.step].description}</p>
                    </StepPanel>
                  </AnimatePresence>
                </div>
                <footer className="onboarding-footer">
                  {flow.saveError && (
                    <p className="onboarding-error" role="alert">
                      {flow.saveError}
                    </p>
                  )}
                  {(flow.step === "worktrees" ||
                    flow.step === "notifications" ||
                    flow.isLastStep) &&
                    flow.settingsError && (
                      <p className="onboarding-error" role="alert">
                        Couldn’t load your preferences.{" "}
                        <Button
                          variant="subtle"
                          className="onboarding-text-button"
                          onClick={flow.retrySettings}
                        >
                          Retry
                        </Button>
                      </p>
                    )}
                  {flow.providerNeedsAttention && (
                    <p className="onboarding-error">
                      Your provider needs another look.{" "}
                      <Button
                        variant="subtle"
                        className="onboarding-text-button"
                        onClick={flow.returnToProviders}
                      >
                        Choose a provider
                      </Button>
                    </p>
                  )}

                  <Button
                    variant="submit"
                    className="onboarding-next"
                    onClick={flow.goNext}
                    disabled={!flow.canContinue}
                  >
                    {flow.isSaving
                      ? "Saving…"
                      : flow.isLastStep
                        ? "Get started"
                        : flow.step === "welcome"
                          ? "Let’s begin"
                          : "Continue"}

                  </Button>
                  <div className="onboarding-footer-note">
                    {flow.step === "providers" ? (
                      <Button
                        variant="subtle"
                        className="onboarding-text-button"
                        onClick={flow.skipProvider}
                      >
                        Set up later
                      </Button>
                    ) : (
                      <span>
                        {flow.step === "welcome"
                          ? ""
                          : "You can change these later in Settings."}
                      </span>
                    )}
                  </div>
                  <div
                    className="onboarding-progress"
                    role="progressbar"
                    aria-label="Setup progress"
                    aria-valuemin={1}
                    aria-valuemax={ONBOARDING_STEPS.length}
                    aria-valuenow={flow.index + 1}
                    aria-valuetext={`Step ${flow.index + 1} of ${ONBOARDING_STEPS.length}`}
                  >
                    {ONBOARDING_STEPS.map((step, index) => (
                      <span
                        key={step}
                        data-current={index === flow.index || undefined}
                        data-complete={index < flow.index || undefined}
                      />
                    ))}
                  </div>
                </footer>
              </aside>
              <div className="onboarding-visual">
                <AnimatePresence
                  initial={false}
                  custom={reducedMotion ? 0 : flow.direction}
                >
                  <StepPanel
                    key={flow.step}
                    direction={flow.direction}
                    reducedMotion={reducedMotion}
                  >
                    {panel}
                  </StepPanel>
                </AnimatePresence>
              </div>
            </section>
            {/* <span className="onboarding-version">
              Mains · v{__APP_VERSION__}
            </span> */}
          </div>
        </main>
      </LazyMotion>
    </MainLayout>
  );
}
