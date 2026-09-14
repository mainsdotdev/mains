import type { CreatePulseInput, UpdatePulseInput, PulseFrequency } from "./pulse.dto";
import {
  DEFAULT_MODE_ID,
  isModeId,
  providerModes,
  providerSupportsMode,
} from "../../../shared/modes";

const FREQUENCIES: PulseFrequency[] = ["hourly", "daily", "weekdays", "weekly"];
const EFFORT_LEVELS = ["", "minimal", "low", "medium", "high", "max", "xhigh"];

export function validateCreate(input: CreatePulseInput): string | null {
  if (input.mode !== undefined && !isModeId(input.mode)) {
    return `Invalid mode: ${input.mode}`;
  }
  const mode = input.mode ?? DEFAULT_MODE_ID;
  // Developer pulses run inside a workspace; work/chat pulses run
  // workspace-less and may target a collection instead.
  if (mode === "developer") {
    if (!input.workspaceId) return "workspaceId is required";
    if (input.collectionId) {
      return "collectionId is only allowed for work/chat pulses";
    }
  } else if (input.workspaceId) {
    return "workspaceId is only allowed for developer pulses";
  }
  if (!input.providerId) return "providerId is required";
  // A pulse executes under a space of its own provider+mode pair, so a pair no
  // provider can hold would only fail later, at fire time.
  if (!providerSupportsMode(input.providerId, mode)) {
    return `${input.providerId} pulses support ${providerModes(input.providerId).join(", ")}`;
  }
  if (!input.model) return "model is required";
  if (!input.title?.trim()) return "title is required";
  if (!input.prompt?.trim()) return "prompt is required";
  if (!FREQUENCIES.includes(input.frequency)) return `Invalid frequency: ${input.frequency}`;

  if (input.frequency === "weekly") {
    if (input.dayOfWeek == null || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      return "dayOfWeek (0-6) is required when frequency is weekly";
    }
  } else if (input.dayOfWeek != null) {
    return "dayOfWeek is only allowed when frequency is weekly";
  }

  if (input.hour < 0 || input.hour > 23) return "hour must be 0-23";
  if (input.minute < 0 || input.minute > 59) return "minute must be 0-59";
  if (!input.timezone?.trim()) return "timezone is required";

  if (input.effortLevel != null && !EFFORT_LEVELS.includes(input.effortLevel)) {
    return `Invalid effortLevel: ${input.effortLevel}`;
  }

  return null;
}

export function validateUpdate(input: UpdatePulseInput): string | null {
  if (input.frequency !== undefined && !FREQUENCIES.includes(input.frequency)) {
    return `Invalid frequency: ${input.frequency}`;
  }
  if (input.hour !== undefined && (input.hour < 0 || input.hour > 23)) {
    return "hour must be 0-23";
  }
  if (input.minute !== undefined && (input.minute < 0 || input.minute > 59)) {
    return "minute must be 0-59";
  }
  if (input.dayOfWeek != null && (input.dayOfWeek < 0 || input.dayOfWeek > 6)) {
    return "dayOfWeek must be 0-6";
  }
  if (
    input.effortLevel != null &&
    !EFFORT_LEVELS.includes(input.effortLevel)
  ) {
    return `Invalid effortLevel: ${input.effortLevel}`;
  }
  return null;
}
