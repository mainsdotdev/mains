// Re-export Workspace and Provider from API modules as single source of truth
export type { Workspace } from "@/lib/redux/api/workspaceApi";
export type { Provider } from "@/lib/redux/api/providersApi";

export interface RunEvent {
  id: string;
  type: "log" | "tool_call" | "artifact" | "status";
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface Run {
  id: string;
  workspaceId?: string | null;
  collectionId?: string | null;
  spaceId?: string | null;
  mode?: "developer" | "work" | "chat";
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  goal: string;
  title?: string;
  providerId: string;
  startedAt?: Date;
  endedAt?: Date;
  lastError?: string;
  createdAt?: Date;
}

export interface ToolCall {
  id: number;
  runId: string;
  toolId?: string;
  toolName: string;
  toolCallId?: string;
  /** Provider tool-use id of the call that spawned this one (subagent children). */
  parentToolCallId?: string | null;
  input?: string;
  output?: string;
  metadata?: Record<string, unknown> | string | null;
  status: string;
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunArtifact {
  id: number;
  runId: string;
  kind: string;
  path?: string;
  content?: string;
  metadata?: string;
  createdAt: Date;
}
