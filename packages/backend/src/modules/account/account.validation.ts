import { FIELD_LIMITS } from "./account.constants";
import type { UpdateAccountRequest } from "./account.dto";

// ─────────────────────────────────────────────────────────────
// Validation Result
// ─────────────────────────────────────────────────────────────
export interface ValidationResult {
  data: Partial<UpdateAccountRequest>;
  errors: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────
// Allowlist - only these fields can be updated
// ─────────────────────────────────────────────────────────────
const ALLOWED_FIELDS = Object.keys(FIELD_LIMITS) as (keyof typeof FIELD_LIMITS)[];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, maxLength);
}

function isValidEmail(value: string): boolean {
  return value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ─────────────────────────────────────────────────────────────
// Main Validation
// ─────────────────────────────────────────────────────────────
export function validateUpdatePayload(payload: unknown): ValidationResult {
  if (typeof payload !== "object" || payload === null) {
    return { data: {}, errors: { body: "Invalid payload" } };
  }

  const input = payload as Record<string, unknown>;
  const data: Partial<UpdateAccountRequest> = {};
  const errors: Record<string, string> = {};

  for (const field of ALLOWED_FIELDS) {
    const limit = FIELD_LIMITS[field];
    const sanitized = sanitizeString(input[field], limit);

    if (sanitized === undefined) continue;

    if (field === "email" && !isValidEmail(sanitized)) {
      errors.email = "Invalid email";
      continue;
    }

    data[field] = sanitized;
  }

  return { data, errors };
}
