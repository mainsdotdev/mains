import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/main";
import { Button, Text } from "@/components/ui";
import { ChevronUp } from "@/components/ui/icons";
import { useAppDispatch } from "@/lib/redux/hooks";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { setOnboardingCompleted } from "@/lib/redux/slices/appSettingsSlice";
import { AgentComparisonStep } from "./agent-comparison-step";
import { CoreFeaturesStep } from "./core-features-step";
import { PreferencesStep } from "./preferences-step";
import { WelcomeIntroStep } from "./welcome-intro-step";

interface OnboardingStep {
  id: string;
  render: () => React.ReactNode;
  /** Step writes real settings — the footer reassures they're not final. */
  changesSettings?: boolean;
}

const STEPS: OnboardingStep[] = [
  { id: "welcome", render: () => <WelcomeIntroStep /> },
  { id: "features", render: () => <CoreFeaturesStep /> },
  { id: "agents", render: () => <AgentComparisonStep />, changesSettings: true },
  { id: "preferences", render: () => <PreferencesStep />, changesSettings: true },
];

// Must match the segment classes below: w-8 = 32px, gap-2 = 8px.
const SEGMENT_WIDTH = 32;
const SEGMENT_GAP = 8;

function StepIndicator({ count, current }: { count: number; current: number }) {
  return (
    <div
      className="relative flex items-center gap-2"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={current + 1}
      aria-label={`Step ${current + 1} of ${count}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-1 w-8 rounded-full bg-primary-500/20" />
      ))}
      {/* Active segment slides over the track between steps */}
      <span
        className="absolute top-0 left-0 h-1 w-8 rounded-full bg-primary-700 transition-transform duration-300 ease-out dark:bg-primary"
        style={{
          transform: `translateX(${current * (SEGMENT_WIDTH + SEGMENT_GAP)}px)`,
        }}
      />
    </div>
  );
}

/**
 * Full-screen first-run flow rendered instead of the app shell until
 * onboarding completes. Reuses MainLayout for the themed (vibrant) background
 * and the frameless-window drag region; steps render directly on the screen
 * with a step counter bottom-left and navigation bottom-right.
 */
export function OnboardingScreen() {
  const dispatch = useAppDispatch();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const isLastStep = stepIndex === STEPS.length - 1;

  const goNext = () => {
    if (isLastStep) {
      dispatch(setOnboardingCompleted(true));
      return;
    }
    setStepIndex((i) => i + 1);
  };

  // Keyboard navigation: ←/→ move between steps, Enter completes on the last
  // step (mirrors the Get Started button).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat)
        return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setStepIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter" && isLastStep) {
        // A focused button handles Enter natively — don't double-fire.
        if (target instanceof HTMLElement && target.closest("button")) return;
        event.preventDefault();
        dispatch(setOnboardingCompleted(true));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLastStep, dispatch]);

  return (
    <MainLayout>
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        {/* The footer floats over this area rather than taking a row, so a long
            step's content runs to the window's bottom edge. The mask dissolves
            whatever passes under the footer instead of slicing it; its 4rem
            fade sits inside the 7rem bottom padding, so the last row is never
            dimmed once scrolled into view. */}
        <div
          className="flex-1 overflow-y-auto px-8 pt-16 pb-28 mask-[linear-gradient(to_bottom,black_0%,black_calc(100%-4rem),transparent_100%)]"
        >
          {/* Keyed remount animates each step in with the app's slide-fade language */}
          <div
            key={STEPS[stepIndex].id}
            className="flex min-h-full flex-col"
            style={
              prefersReducedMotion
                ? undefined
                : { animation: "slide-fade-down 300ms ease-in-out" }
            }
          >
            {STEPS[stepIndex].render()}
          </div>
        </div>
        <footer className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 py-5">
          <StepIndicator count={STEPS.length} current={stepIndex} />
          {/* Agents + preferences steps change real settings — reassure it's not final */}
          {STEPS[stepIndex].changesSettings && (
            <Text
              as="span"
              size="s"
              tone="secondary"
              className="absolute left-1/2 -translate-x-1/2"
            >
              You can change these later in Settings.
            </Text>
          )}
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button
                variant="ghost"
                onClick={() => setStepIndex((i) => i - 1)}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm"
              >
                <ChevronUp className="w-4 h-4 -rotate-90" />
                Back
              </Button>
            )}
            <Button
              variant={isLastStep ? "submit" : "ghost"}
              onClick={goNext}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm glass-outline"
            >
              {isLastStep ? "Get Started" : "Continue"}
              {isLastStep ? (
                <Text
                  as="kbd"
                  size="s"
                  tone="inherit"
                  className="ml-0.5 mt-1 flex h-4 items-center font-sans leading-none"
                  aria-hidden
                >
                  ⏎
                </Text>
              ) : (
                <ChevronUp className="w-4 h-4 rotate-90" />
              )}
            </Button>
          </div>
        </footer>
      </div>
    </MainLayout>
  );
}
