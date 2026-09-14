/**
 * Pulls a human-readable message out of the various error shapes that show up
 * in this app: RTK Query rejections, IPC `ServiceResponse` errors, thrown
 * `Error` instances, and bare strings.
 *
 * Use everywhere instead of writing `err?.data?.error || err?.message || ...`
 * inline — keeps the resolution order consistent across the UI.
 */
export function extractErrorMessage(
  err: unknown,
  fallback = "An error occurred",
): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;

  const e = err as Record<string, unknown>;

  // RTK Query CUSTOM_ERROR shape: { status: "CUSTOM_ERROR", error: string }
  if (e.status === "CUSTOM_ERROR" && typeof e.error === "string") {
    return e.error;
  }

  // RTK Query rejected payload: { data: { error: string } | { message: string } }
  const data = e.data as Record<string, unknown> | undefined;
  if (data) {
    if (typeof data.error === "string") return data.error;
    if (typeof data.message === "string") return data.message;
  }

  // Standard Error / generic { message }
  if (typeof e.message === "string") return e.message;

  return fallback;
}
