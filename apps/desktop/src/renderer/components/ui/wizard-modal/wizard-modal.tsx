/* eslint-disable react-hooks/refs */
/* TODO: */
import {
  useRef,
  useEffect,
  useCallback,
  useSyncExternalStore,
  useReducer,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { WizardProvider, type WizardContextValue } from "./wizard-context";
import { usePrefersReducedMotion } from "../../../hooks/use-prefers-reduced-motion";
import { useSuppressBrowserView } from "../../../hooks/use-suppress-browser-view";
import { Button } from "../button";
import { Close } from "../icons";
import { Heading3 } from "../text";
import { wizardReducer, resolveInitialStep } from "./wizard-reducer";
import { useWizardEscape, useWizardFocusTrap } from "./use-wizard-keyboard";
import { useWizardAnimation } from "./use-wizard-animation";
import { useWizardNavigation } from "./use-wizard-navigation";

export interface WizardStep<
  TData extends Record<string, any> = Record<string, any>,
> {
  id: string;
  title?: string;
  /** Shown beside the step title in the modal header (per-step; overrides modal `icon`). */
  titleIcon?: ReactNode;
  render: (ctx: WizardContextValue<TData>) => React.ReactNode;
  canNext?: (ctx: WizardContextValue<TData>) => boolean;
  canBack?: (ctx: WizardContextValue<TData>) => boolean;
  onNext?: (
    ctx: WizardContextValue<TData>,
  ) => boolean | void | Promise<boolean | void>;
  onBack?: (
    ctx: WizardContextValue<TData>,
  ) => boolean | void | Promise<boolean | void>;
}

export interface WizardModalProps<
  TData extends Record<string, any> = Record<string, any>,
> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: WizardStep<TData>[];
  initialStep?: string | number;
  initialData?: Partial<TData>;
  title?: string;
  icon?: string;
  onComplete?: (data: TData) => void;
  onCancel?: () => void;
  className?: string;
  animationDuration?: number;
}

const emptySubscribe = () => () => {};

export function WizardModal<
  TData extends Record<string, any> = Record<string, any>,
>({
  open,
  onOpenChange,
  steps,
  initialStep,
  initialData,
  title,
  icon,
  onComplete,
  onCancel,
  className = "",
  animationDuration = 200,
}: WizardModalProps<TData>) {
  const isBrowser = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const [state, dispatch] = useReducer(
    wizardReducer<TData>,
    undefined,
    () => ({
      stepIndex: resolveInitialStep(steps, initialStep),
      data: (initialData ?? {}) as TData,
      errors: {} as Record<string, string>,
      isSubmitting: false,
      animState: { height: "auto" as number | "auto", active: false },
    }),
  );

  const { stepIndex, data, errors, isSubmitting, animState } = state;

  // Sync stepIndex when steps array changes (e.g., loading → real steps)
  const prevStepsLengthRef = useRef(steps.length);
  const prevStepIdsRef = useRef(steps.map((s) => s.id).join(","));
  useEffect(() => {
    const prevLen = prevStepsLengthRef.current;
    const newLen = steps.length;
    const prevIds = prevStepIdsRef.current;
    const newIds = steps.map((s) => s.id).join(",");

    prevStepsLengthRef.current = newLen;
    prevStepIdsRef.current = newIds;

    // Only sync when steps array structure actually changed (loading → actual steps)
    if (prevLen !== newLen || prevIds !== newIds) {
      const newIndex = resolveInitialStep(steps, initialStep);
      dispatch({ type: "SET_STEP", index: newIndex });
    }
  }, [steps, initialStep]);

  // Sync data when initialData changes (loading → actual data)
  const prevInitialDataRef = useRef(initialData);
  useEffect(() => {
    if (initialData !== prevInitialDataRef.current) {
      prevInitialDataRef.current = initialData;
      if (initialData) {
        dispatch({ type: "SET_DATA", data: initialData as Partial<TData> });
      }
    }
  }, [initialData]);

  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate = !prefersReducedMotion && animationDuration > 0;

  const currentStep = steps[stepIndex];
  const displayTitle = currentStep?.title ?? title;
  const displayTitleIcon = currentStep?.titleIcon;

  const setData = useCallback((partial: Partial<TData>) => {
    dispatch({ type: "SET_DATA", data: partial });
  }, []);

  const setErrors = useCallback((partial: Record<string, string>) => {
    dispatch({ type: "SET_ERRORS", errors: partial });
  }, []);

  const clearErrors = useCallback(() => {
    dispatch({ type: "CLEAR_ERRORS" });
  }, []);

  const setIsSubmitting = useCallback((value: boolean) => {
    dispatch({ type: "SET_SUBMITTING", value });
  }, []);

  const close = useCallback(() => {
    if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
    onOpenChange(false);
    onCancel?.();
  }, [onOpenChange, onCancel]);

  // Extracted hooks
  const prevHeightRef = useWizardAnimation(
    stepIndex,
    shouldAnimate,
    animationDuration,
    innerRef,
    dispatch,
  );
  useWizardEscape(open, isSubmitting, close);
  useWizardFocusTrap(open, stepIndex);
  // The embedded browser panel is a native view that paints above all DOM
  // content — hide it while the wizard is open so the modal isn't occluded.
  useSuppressBrowserView(open);

  const { contextValue } = useWizardNavigation<TData>({
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
  });

  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    setPrevOpen(true);
    triggerRef.current = document.activeElement as HTMLElement;
    prevHeightRef.current = 0;
    dispatch({
      type: "RESET",
      stepIndex: resolveInitialStep(steps, initialStep),
      data: (initialData ?? {}) as TData,
    });
  }
  if (!open && prevOpen) {
    setPrevOpen(false);
  }

  if (!isBrowser || !open) return null;

  const contentStyle: React.CSSProperties = {
    height: animState.height,
    overflow: animState.active ? "hidden" : undefined,
    transition:
      shouldAnimate && animState.active
        ? `height ${animationDuration}ms ease-out`
        : undefined,
  };

  return createPortal(
    <div className="fixed inset-0 z-(--z-modal) flex items-center justify-center p-4">
      <div
        className="absolute inset-0 dark:bg-primary-950/60 bg-primary/80  "
        onClick={() => !isSubmitting && close()}
        aria-hidden="true"
      />

      <div
        id="wizard-modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        className={`relative z-(--z-overlay) w-full rounded-3xl overflow-hidden glass-surface ${className.includes("max-w-") ? "" : "max-w-2xl"} ${className}`}
        style={{
          animation: shouldAnimate
            ? "wizardModalIn 250ms cubic-bezier(0.22, 1, 0.36, 1) both"
            : undefined,
        }}
      >
        <div className="relative z-10 flex items-center justify-between pl-4 pr-3 pt-4">
          <div className="flex min-h-9 items-center gap-2">
            {displayTitleIcon != null ? (
              <span
                className="flex size-8 shrink-0 items-center justify-center [&_svg]:size-7 [&>div]:flex [&>div]:size-9 [&>div]:items-center [&>div]:justify-center"
                aria-hidden
              >
                {displayTitleIcon}
              </span>
            ) : (
              icon && (
                <img
                  src={icon}
                  alt=""
                  className="w-9 h-9"
                  width={256}
                  height={256}
                />
              )
            )}
            <span id="wizard-title">
              <Heading3>{displayTitle}</Heading3>
            </span>
          </div>
          <Button
            onClick={() => !isSubmitting && close()}
            disabled={isSubmitting}
            aria-label="Close modal"
        className="rounded-full cursor-pointer hover:bg-primary-100 dark:hover:bg-primary/10 p-1.5 glass-button text-primary-900 dark:text-primary-100 transition-all duration-300 ease-out"
          >
            <Close className="size-4" />
          </Button>
        </div>

        {/* Animated height container */}
        <div ref={contentRef} style={contentStyle}>
          {/* Inner wrapper for measuring natural height */}
          <div ref={innerRef} className="p-6">
            <WizardProvider value={contextValue}>
              {/* Step content with fade animation */}
              <div
                key={stepIndex}
                style={{
                  animation: shouldAnimate
                    ? "wizardStepFade 150ms ease-out"
                    : undefined,
                }}
              >
                {currentStep?.render(contextValue)}
              </div>
            </WizardProvider>
          </div>
        </div>
      </div>

    </div>,
    document.body,
  );
}
