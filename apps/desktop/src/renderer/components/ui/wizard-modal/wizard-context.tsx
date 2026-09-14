import { createContext, useContext, useCallback, useMemo } from "react";

export interface WizardContextValue<TData extends Record<string, any> = Record<string, any>> {
  /** Current step index */
  stepIndex: number;
  /** Total number of steps */
  stepCount: number;
  /** Navigate to next step */
  goNext: () => void;
  /** Navigate to previous step */
  goBack: () => void;
  /** Navigate to specific step by index or ID */
  goTo: (indexOrId: number | string) => void;
  /** Shared wizard data object */
  data: TData;
  /** Update wizard data (shallow merge) */
  setData: (partial: Partial<TData>) => void;
  /** Validation errors keyed by field name */
  errors: Record<string, string>;
  /** Set validation errors (shallow merge) */
  setErrors: (partial: Record<string, string>) => void;
  /** Clear all errors */
  clearErrors: () => void;
  /** Whether a submission is in progress */
  isSubmitting: boolean;
  /** Set submitting state */
  setIsSubmitting: (value: boolean) => void;
  /** Close the wizard modal */
  close: () => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider<TData extends Record<string, any>>({
  children,
  value,
}: {
  children: React.ReactNode;
  value: WizardContextValue<TData>;
}) {
  return (
    <WizardContext.Provider value={value as WizardContextValue}>
      {children}
    </WizardContext.Provider>
  );
}

/**
 * Hook to access wizard context.
 * Must be used within a WizardModal.
 */
export function useWizard<TData extends Record<string, any> = Record<string, any>>(): WizardContextValue<TData> {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error("useWizard must be used within a WizardModal");
  }
  return context as WizardContextValue<TData>;
}

/**
 * Helper hook to bind a form field to wizard data.
 * Returns value, onChange handler, and error.
 */
export function useWizardField<T = string>(
  key: string,
  defaultValue?: T
): {
  value: T;
  onChange: (value: T) => void;
  error: string | undefined;
  setError: (error: string) => void;
  clearError: () => void;
} {
  const { data, setData, errors, setErrors } = useWizard();

  const value = (data[key] ?? defaultValue) as T;

  const onChange = useCallback(
    (newValue: T) => {
      setData({ [key]: newValue } as any);
      // Clear error when user changes value
      if (errors[key]) {
        setErrors({ [key]: "" });
      }
    },
    [key, setData, errors, setErrors]
  );

  const setError = useCallback(
    (error: string) => {
      setErrors({ [key]: error });
    },
    [key, setErrors]
  );

  const clearError = useCallback(() => {
    setErrors({ [key]: "" });
  }, [key, setErrors]);

  return useMemo(
    () => ({
      value,
      onChange,
      error: errors[key] || undefined,
      setError,
      clearError,
    }),
    [value, onChange, errors, key, setError, clearError]
  );
}
