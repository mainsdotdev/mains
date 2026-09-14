import type {
  CreatePulseInput,
  Pulse,
  PulseFrequency,
} from "@/lib/redux/api/pulseApi";
import type { ModeId } from "../../../../shared/modes";
import type { PulseTemplate } from "../templates";

export interface PulseFormState {
  title: string;
  prompt: string;
  /** Experience mode the pulse runs under — fixed at creation. */
  mode: ModeId;
  /** Developer pulses target a workspace… */
  workspaceId: string;
  /** …work/chat pulses optionally target a collection ("" = standalone). */
  collectionId: string;
  providerId: string;
  model: string;
  frequency: PulseFrequency;
  hour: number;
  minute: number;
  dayOfWeek: number | null;
  thinkingMode: boolean;
  effortLevel: string;
}

const getLocalTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

export const EMPTY_PULSE_FORM: PulseFormState = {
  title: "",
  prompt: "",
  mode: "developer",
  workspaceId: "",
  collectionId: "",
  providerId: "",
  model: "",
  frequency: "daily",
  hour: 9,
  minute: 0,
  dayOfWeek: null,
  thinkingMode: false,
  effortLevel: "",
};

export function pulseToForm(pulse: Pulse): PulseFormState {
  return {
    title: pulse.title,
    prompt: pulse.prompt,
    mode: pulse.mode,
    workspaceId: pulse.workspaceId ?? "",
    collectionId: pulse.collectionId ?? "",
    providerId: pulse.providerId,
    model: pulse.model,
    frequency: pulse.frequency,
    hour: pulse.hour,
    minute: pulse.minute,
    dayOfWeek: pulse.dayOfWeek,
    thinkingMode: pulse.thinkingMode,
    effortLevel: pulse.effortLevel ?? "",
  };
}

export function applyTemplate(
  form: PulseFormState,
  template: PulseTemplate,
): PulseFormState {
  return {
    ...form,
    title: template.title,
    prompt: template.prompt,
    frequency: template.defaultFrequency,
    hour: template.defaultHour,
    minute: template.defaultMinute,
    dayOfWeek:
      template.defaultFrequency === "weekly"
        ? template.defaultDayOfWeek ?? 1
        : null,
  };
}

export function formToCreateInput(form: PulseFormState): CreatePulseInput {
  const isDeveloper = form.mode === "developer";
  return {
    title: form.title.trim(),
    prompt: form.prompt.trim(),
    mode: form.mode,
    workspaceId: isDeveloper ? form.workspaceId : null,
    collectionId: !isDeveloper && form.collectionId ? form.collectionId : null,
    providerId: form.providerId,
    model: form.model,
    frequency: form.frequency,
    hour: form.hour,
    minute: form.minute,
    dayOfWeek: form.frequency === "weekly" ? form.dayOfWeek ?? 1 : null,
    thinkingMode: form.thinkingMode,
    effortLevel: form.effortLevel || null,
    timezone: getLocalTimezone(),
    isActive: true,
  };
}

/** A pulse can be saved once it has a title, a prompt, and a full run target.
 *  Only developer pulses need a workspace; work/chat run workspace-less. */
export function isPulseFormValid(form: PulseFormState): boolean {
  return (
    form.title.trim().length > 0 &&
    form.prompt.trim().length > 0 &&
    (form.mode !== "developer" || !!form.workspaceId) &&
    !!form.providerId &&
    !!form.model
  );
}
