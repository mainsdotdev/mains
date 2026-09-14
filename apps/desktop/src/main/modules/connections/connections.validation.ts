import type { UpdateConnectionStateRequest } from "./connections.dto";

// ─────────────────────────────────────────────────────────────
// Validation Result
// ─────────────────────────────────────────────────────────────
export interface ValidationResult {
  data: UpdateConnectionStateRequest | null;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────
export function validateConnectionStateId(id: unknown): string | null {
  if (!id || typeof id !== "string") {
    return "Invalid connection ID";
  }
  return null;
}

export function validateUpdateStatePayload(payload: unknown): ValidationResult {
  if (typeof payload !== "object" || payload === null) {
    return { data: null, error: "Invalid payload" };
  }

  const input = payload as Record<string, unknown>;

  if (typeof input.isConnected !== "boolean") {
    return { data: null, error: "isConnected must be a boolean" };
  }

  return {
    data: {
      isConnected: input.isConnected,
      connectionId:
        typeof input.connectionId === "string" ? input.connectionId : null,
    },
    error: null,
  };
}
