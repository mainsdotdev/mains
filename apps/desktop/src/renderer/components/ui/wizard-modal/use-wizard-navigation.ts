import { useCallback, useMemo } from "react";
import type { WizardContextValue } from "./wizard-context";
import type { WizardStep } from "./wizard-modal";

interface NavigationDeps<TData extends Record<string, any>> {
  steps: WizardStep<TData>[];
  stepIndex: number;
  data: TData;
  errors: Record<string, string>;
  isSubmitting: boolean;
  setData: (partial: Partial<TData>) => void;
  setErrors: (partial: Record<string, string>) => void;
  clearErrors: () => void;
  setIsSubmitting: (value: boolean) => void;
  close: () => void;
  onComplete?: (data: TData) => void;
  dispatch: (action: any) => void;
}

export function useWizardNavigation<TData extends Record<string, any>>({
  steps,
  stepIndex,
  data,
  errors,
  isSubmitting,
  setData,
  setErrors,
  clearErrors,
  setIsSubmitting,
  close,
  onComplete,
  dispatch,
}: NavigationDeps<TData>) {
  const buildCtx = useCallback(
    (): WizardContextValue<TData> => ({
      stepIndex,
      stepCount: steps.length,
      goNext: () => {},
      goBack: () => {},
      goTo: () => {},
      data,
      setData,
      errors,
      setErrors,
      clearErrors,
      isSubmitting,
      setIsSubmitting,
      close,
    }),
    [stepIndex, steps.length, data, setData, errors, setErrors, clearErrors, isSubmitting, setIsSubmitting, close],
  );

  const goTo = useCallback(
    (indexOrId: number | string) => {
      const targetIndex =
        typeof indexOrId === "number"
          ? indexOrId
          : steps.findIndex((s) => s.id === indexOrId);

      if (targetIndex < 0 || targetIndex >= steps.length) return;
      if (targetIndex === stepIndex) return;

      dispatch({ type: "SET_STEP", index: targetIndex });
    },
    [steps, stepIndex, dispatch],
  );

  const goNext = useCallback(async () => {
    if (stepIndex >= steps.length - 1) {
      onComplete?.(data);
      return;
    }

    const step = steps[stepIndex];
    const ctx = buildCtx();

    if (step.canNext && !step.canNext(ctx)) return;

    if (step.onNext) {
      const result = await step.onNext(ctx);
      if (result === false) return;
    }

    dispatch({ type: "INC_STEP" });
  }, [stepIndex, steps, data, onComplete, buildCtx, dispatch]);

  const goBack = useCallback(async () => {
    if (stepIndex <= 0) return;

    const step = steps[stepIndex];
    const ctx = buildCtx();

    if (step.canBack && !step.canBack(ctx)) return;

    if (step.onBack) {
      const result = await step.onBack(ctx);
      if (result === false) return;
    }

    dispatch({ type: "DEC_STEP" });
  }, [stepIndex, steps, buildCtx, dispatch]);

  const contextValue = useMemo<WizardContextValue<TData>>(
    () => ({
      stepIndex,
      stepCount: steps.length,
      goNext,
      goBack,
      goTo,
      data,
      setData,
      errors,
      setErrors,
      clearErrors,
      isSubmitting,
      setIsSubmitting,
      close,
    }),
    [
      stepIndex,
      steps.length,
      goNext,
      goBack,
      goTo,
      data,
      setData,
      errors,
      setErrors,
      clearErrors,
      isSubmitting,
      setIsSubmitting,
      close,
    ],
  );

  return { goTo, goNext, goBack, contextValue };
}
