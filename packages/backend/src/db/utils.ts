/**
 * Safely parse a JSON string, returning a fallback on failure.
 * Prevents uncaught exceptions from corrupted JSON columns in the database.
 */
export function safeJsonParse<T = unknown>(value: string | null | undefined, fallback: T | null = null): T | null {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    console.error("[DB] Failed to parse JSON column:", err);
    return fallback;
  }
}
