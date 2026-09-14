export type AnimState = { height: number | "auto"; active: boolean };

export interface WizardState<TData> {
  stepIndex: number;
  data: TData;
  errors: Record<string, string>;
  isSubmitting: boolean;
  animState: AnimState;
}

export type WizardAction<TData> =
  | { type: "RESET"; stepIndex: number; data: TData }
  | { type: "SET_STEP"; index: number }
  | { type: "INC_STEP" }
  | { type: "DEC_STEP" }
  | { type: "SET_DATA"; data: Partial<TData> }
  | { type: "REPLACE_DATA"; data: TData }
  | { type: "SET_ERRORS"; errors: Record<string, string> }
  | { type: "CLEAR_ERRORS" }
  | { type: "SET_SUBMITTING"; value: boolean }
  | { type: "SET_ANIM"; animState: AnimState };

export function wizardReducer<TData extends Record<string, any>>(
  state: WizardState<TData>,
  action: WizardAction<TData>,
): WizardState<TData> {
  switch (action.type) {
    case "RESET":
      return {
        stepIndex: action.stepIndex,
        data: action.data,
        errors: {},
        isSubmitting: false,
        animState: { height: "auto", active: false },
      };
    case "SET_STEP":
      return { ...state, stepIndex: action.index };
    case "INC_STEP":
      return { ...state, stepIndex: state.stepIndex + 1 };
    case "DEC_STEP":
      return { ...state, stepIndex: state.stepIndex - 1 };
    case "SET_DATA":
      return { ...state, data: { ...state.data, ...action.data } };
    case "REPLACE_DATA":
      return { ...state, data: action.data };
    case "SET_ERRORS":
      return { ...state, errors: { ...state.errors, ...action.errors } };
    case "CLEAR_ERRORS":
      return { ...state, errors: {} };
    case "SET_SUBMITTING":
      return { ...state, isSubmitting: action.value };
    case "SET_ANIM":
      return { ...state, animState: action.animState };
    default:
      return state;
  }
}

export function resolveInitialStep(
  steps: { id: string }[],
  initial?: string | number,
): number {
  if (initial === undefined) return 0;
  if (typeof initial === "number") {
    return Math.max(0, Math.min(initial, steps.length - 1));
  }
  const idx = steps.findIndex((s) => s.id === initial);
  return idx >= 0 ? idx : 0;
}
