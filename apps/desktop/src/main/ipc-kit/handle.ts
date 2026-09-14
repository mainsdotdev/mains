import {
  ok,
  fail,
  type ServiceResponse,
} from "../../shared/ipc-kit/service-response";

/**
 * Wrap a throw-style service function into an `ipcMain.handle` handler that
 * returns the ServiceResponse envelope: the resolved value becomes `ok(data)`,
 * a throw becomes `fail(message)` (logged here).
 *
 * This is where the envelope lives for throw-style modules — services return
 * plain `T` and throw on failure; only the IPC seam builds ServiceResponse.
 * The git module pilots this convention (see CONTEXT.md "git module");
 * other modules still construct envelopes in their services.
 *
 * The first handler parameter (the Electron event / WS invoke context) is
 * dropped — handlers that need it stay hand-written.
 */
/**
 * Failures that say "the thing isn't there", which is a state the app is built
 * to handle (a workspace folder deleted under it, a file removed between listing
 * and reading). The caller still gets `fail(...)`; only the logging is quieter,
 * so a stack trace keeps meaning "something unexpected happened".
 */
function isExpectedAbsence(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return true;
  // "no longer exists" is the deliberate refusal raised by the workspace
  // run-start guard — an intended outcome, not a defect to dump a stack for.
  return /\b(does not exist|no longer exists|no such file or directory)\b/i.test(
    error.message,
  );
}

export function handle<Args extends unknown[], T>(
  fn: (...args: Args) => T | Promise<T>,
): (ctx: unknown, ...args: Args) => Promise<ServiceResponse<T>> {
  return async (_ctx, ...args) => {
    try {
      return ok(await fn(...args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isExpectedAbsence(error)) {
        console.warn(`[ipc] handler failed: ${message}`);
      } else {
        console.error("[ipc] handler failed:", error);
      }
      return fail(message);
    }
  };
}
