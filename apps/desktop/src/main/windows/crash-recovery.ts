import { app, dialog, type BrowserWindow } from "electron";

/**
 * Keeping the window alive when its renderer is not. The UI runs in its own
 * process; when that process crashes (out of memory on a huge transcript, a GPU
 * fault, macOS reclaiming memory) the window stays up with nothing in it, and
 * Cmd+R is disabled — the user's only way out used to be quitting. Everything
 * that matters lives in main and the database, so a reload loses nothing but
 * an unsent draft.
 *
 *  - Crash → reload on its own, unless it keeps happening (a crash loop), then
 *    ask.
 *  - Hang → ask: it may recover by itself, and a reload is the user's call.
 *    The prompt goes away if the window comes back.
 */

export { createCrashLoopGuard, type CrashLoopGuard } from "../../shared/window-lifecycle";
import { createCrashLoopGuard, createWindowRecoveryLifecycle, type CrashLoopGuard } from "../../shared/window-lifecycle";

let quitting = false;
let watchingQuit = false;
const attached = new WeakMap<BrowserWindow, () => void>();
const releases = new Set<() => void>();

function watchQuit(): void {
  if (watchingQuit) return;
  watchingQuit = true;
  app.on("before-quit", () => {
    quitting = true;
    for (const release of [...releases]) release();
  });
}

export function attachCrashRecovery(
  window: BrowserWindow,
  guard: CrashLoopGuard = createCrashLoopGuard(),
): () => void {
  watchQuit();
  const existing = attached.get(window);
  if (existing) return existing;
  if (quitting || window.isDestroyed()) return () => {};
  const contents = window.webContents;
  const lifecycle = createWindowRecoveryLifecycle(guard);
  const reload = () => { if (!quitting && !window.isDestroyed()) contents.reload(); };

  const showPrompt = (ticket: NonNullable<ReturnType<typeof lifecycle.hung>>, reason?: string) => {
    const isCrash = ticket.kind === "crash";
    void (async () => {
      if (ticket.signal.aborted || window.isDestroyed()) return null;
      return dialog.showMessageBox(window, {
        type: isCrash ? "error" : "warning",
        message: isCrash ? "Mains keeps crashing" : "Mains is not responding",
        detail: isCrash
          ? `The window crashed repeatedly within a minute (last: ${reason}). Running agents keep going — reload to try again.`
          : "You can wait for it to recover, or reload the window. Running agents keep going either way.",
        buttons: isCrash ? ["Reload", "Quit Mains"] : ["Wait", "Reload"],
        defaultId: 0,
        cancelId: 0,
        signal: ticket.signal,
      });
    })().then((result) => {
      if (!result || quitting || window.isDestroyed()) return;
      const action = lifecycle.respond(ticket, result.response);
      if (action === "quit") app.quit();
      else if (action === "restart") { contents.forcefullyCrashRenderer(); reload(); }
      else if (action === "reload") reload();
    }).catch((error) => {
      if (lifecycle.reject(ticket)) console.error("Unable to show window recovery prompt:", error);
    });
  };
  const onGone = (_event: unknown, details: { reason: string; exitCode: number }) => {
    console.error(`[window] renderer gone: ${details.reason} (exit code ${details.exitCode})`);
    if (window.isDestroyed()) return;
    const action = lifecycle.crashed(details.reason, Date.now());
    if (action === "reload") reload();
    else if (action !== "ignore") showPrompt(action, details.reason);
  };
  const onHung = () => {
    const ticket = lifecycle.hung();
    if (ticket) showPrompt(ticket);
  };
  const onResponsive = () => lifecycle.responsive();
  const dispose = () => {
    lifecycle.close();
    contents.removeListener("render-process-gone", onGone);
    window.removeListener("unresponsive", onHung);
    window.removeListener("responsive", onResponsive);
    window.removeListener("closed", dispose);
    attached.delete(window);
    releases.delete(dispose);
  };
  attached.set(window, dispose);
  releases.add(dispose);
  contents.on("render-process-gone", onGone);
  window.on("unresponsive", onHung);
  window.on("responsive", onResponsive);
  window.once("closed", dispose);
  return dispose;
}

/** Log the other helper processes (GPU, utilities) when they die. */
export function watchChildProcesses(): void {
  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    const name = details.name ?? details.serviceName ?? details.type;
    console.error(
      `[app] ${name} process gone: ${details.reason} (exit code ${details.exitCode})`,
    );
  });
}
