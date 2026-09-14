import type { pulses } from "../../db/schema";
import type { ModeId } from "../../../shared/modes";

export type Pulse = typeof pulses.$inferSelect;
export type PulseFrequency = Pulse["frequency"];

export type CreatePulseInput = {
  /** Required for developer pulses; work/chat pulses run workspace-less. */
  workspaceId?: string | null;
  /** Optional collection target for work/chat pulses (sources travel with it). */
  collectionId?: string | null;
  /** Experience mode the pulse's runs execute under. Defaults to developer. */
  mode?: ModeId;
  providerId: string;
  model: string;
  title: string;
  prompt: string;
  frequency: PulseFrequency;
  dayOfWeek?: number | null;
  hour: number;
  minute: number;
  timezone: string;
  thinkingMode?: boolean;
  effortLevel?: string | null;
  isActive?: boolean;
};

export type UpdatePulseInput = Partial<
  Pick<
    Pulse,
    | "workspaceId"
    | "collectionId"
    | "providerId"
    | "model"
    | "title"
    | "prompt"
    | "frequency"
    | "dayOfWeek"
    | "hour"
    | "minute"
    | "timezone"
    | "thinkingMode"
    | "effortLevel"
    | "isActive"
  >
>;
