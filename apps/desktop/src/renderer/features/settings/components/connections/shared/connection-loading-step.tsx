import { useEffect } from "react";
import { useWizard, Muted } from "@/components/ui";

type StepId = "loading" | "setToken" | "add" | "manage";

function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center space-y-3">
        <Muted className="shine-text">{message}</Muted>
      </div>
    </div>
  );
}

interface ConnectionLoadingStepProps {
  targetStep: StepId | null;
  message?: string;
}

export function ConnectionLoadingStep({
  targetStep,
  message = "Loading...",
}: ConnectionLoadingStepProps) {
  const { goTo } = useWizard<any>();

  useEffect(() => {
    if (targetStep && targetStep !== "loading") {
      goTo(targetStep);
    }
  }, [targetStep, goTo]);

  return <LoadingState message={message} />;
}
