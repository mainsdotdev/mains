// ─────────────────────────────────────────────────────────────
// Tool Call Types
// ─────────────────────────────────────────────────────────────

export type ToolCallStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "canceled";

// ─────────────────────────────────────────────────────────────
// Tool Call DTOs
// ─────────────────────────────────────────────────────────────
export interface CreateToolCallPayload {
  accountId: string;
  runId?: string;
  providerId?: string;
  toolName: string;
  toolCallId?: string | null;
  parentToolCallId?: string | null;
  status?: ToolCallStatus;
  metadata?: Record<string, unknown> | null;

  input?: Record<string, unknown>;
}

export interface UpdateToolCallPayload {
  status?: ToolCallStatus;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: Date;
  endedAt?: Date;
  latencyMs?: number;
  costMicros?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCallResponse {
  id: number;
  accountId: string;
  runId: string | null;
  providerId: string | null;
  toolName: string;
  toolCallId: string | null;
  parentToolCallId: string | null;
  status: ToolCallStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  latencyMs: number | null;
  costMicros: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

