import type { ConversationSettings } from "./run-settings";
import type { ModeId } from "./modes";

/** Voices advertised for the provider's native conversation protocol. */
export interface RealtimeVoiceCatalog {
  voices: string[];
  defaultVoice: string;
}

export type VoiceOrbColor = "theme" | "blue" | "violet" | "rose" | "amber" | "mint";
export type VoiceOrbStyle = "cloud" | "sphere" | "aurora";

/** Durable navigation target stored in the coordinator's existing artifacts. */
export interface VoiceTaskLink {
  taskKey: string;
  id: string;
  title: string;
  spaceId: string | null;
  providerId: string;
  mode: ModeId;
  workspaceId: string | null;
  collectionId: string | null;
}

/** Prepare a conversation without sending a prompt or starting a work turn. */
export interface CreateRealtimeConversationPayload {
  accountId: string;
  spaceId?: string;
  workspaceId?: string;
  collectionId?: string;
  conversationSettings?: ConversationSettings;
  additionalDirectories?: string[];
}

export interface CreateRealtimeConversationResponse {
  runId: string;
}

export interface RunRealtimeStartPayload {
  runId: string;
  accountId: string;
  /** Identifies this attempt, so a late reply cannot stop a newer call. */
  connectionId: string;
  sdp: string;
  conversationSettings?: ConversationSettings;
}

export type RunRealtimeStopPayload = Pick<RunRealtimeStartPayload,
  "runId" | "accountId" | "connectionId"
>;

export type RunRealtimeUpdate =
  | { type: "started"; sessionId: string | null }
  | { type: "ending" }
  | { type: "sdp"; sdp: string }
  | { type: "transcript"; itemId: string; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "context"; eventId: string; content: string; announce: boolean }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string | null }
;

export type RunRealtimeEvent = { runId: string; connectionId: string } & RunRealtimeUpdate;
