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

const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 60_000;

export interface CrashLoopGuard {
  /** Count a crash; true while reloading on our own is still reasonable. */
  record(now: number): boolean;
  reset(): void;
}

/** Reload after a crash — until `limit` crashes land within `windowMs`. */
export function createCrashLoopGuard(
  limit = CRASH_LIMIT,
  windowMs = CRASH_WINDOW_MS,
): CrashLoopGuard {
  let crashes: number[] = [];
  return {
    record(now) {
      crashes = [...crashes.filter((at) => now - at < windowMs), now];
      return crashes.length < limit;
    },
    reset() {
      crashes = [];
    },
  };
}

let quitting = false;
let watchingQuit = false;

function watchQuit(): void {
  if (watchingQuit) return;
  watchingQuit = true;
  // Renderers die on the way out; that is not a crash to recover from.
  app.on("before-quit", () => {
    quitting = true;
  });
}

export function attachCrashRecovery(
  window: BrowserWindow,
  guard: CrashLoopGuard = createCrashLoopGuard(),
): void {
  watchQuit();
  const contents = window.webContents;
  /** Set when we kill a hung renderer ourselves — that exit is not a crash. */
  let restartingHungRenderer = false;
  let hangPrompt: AbortController | null = null;

  const reload = () => {
    if (!window.isDestroyed()) contents.reload();
  };

  contents.on("render-process-gone", (_event, details) => {
    console.error(
      `[window] renderer gone: ${details.reason} (exit code ${details.exitCode})`,
    );
    hangPrompt?.abort();
    if (quitting || window.isDestroyed() || details.reason === "clean-exit") return;

    if (restartingHungRenderer) {
      // The hang prompt already reloaded into a fresh process.
      restartingHungRenderer = false;
      return;
    }
    if (guard.record(Date.now())) {
      reload();
      return;
    }

    void dialog
      .showMessageBox(window, {
        type: "error",
        message: "Mains keeps crashing",
        detail:
          `The window crashed ${CRASH_LIMIT} times within a minute (last: ${details.reason}). ` +
          "Running agents keep going — reload to try again.",
        buttons: ["Reload", "Quit Mains"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 1) {
          app.quit();
          return;
        }
        guard.reset();
        reload();
      });
  });

  window.on("unresponsive", () => {
    if (hangPrompt || quitting) return;
    console.warn("[window] renderer is not responding");
    const prompt = new AbortController();
    hangPrompt = prompt;
    void dialog
      .showMessageBox(window, {
        type: "warning",
        message: "Mains is not responding",
        detail:
          "You can wait for it to recover, or reload the window. Running agents keep going either way.",
        buttons: ["Wait", "Reload"],
        defaultId: 0,
        cancelId: 0,
        // Closed for us (as "Wait") when the window recovers.
        signal: prompt.signal,
      })
      .then(({ response }) => {
        if (hangPrompt === prompt) hangPrompt = null;
        if (response !== 1 || window.isDestroyed()) return;
        // A hung renderer can't navigate; kill it so the reload gets a new one.
        restartingHungRenderer = true;
        contents.forcefullyCrashRenderer();
        reload();
      });
  });

  window.on("responsive", () => {
    if (!hangPrompt) return;
    console.warn("[window] renderer recovered");
    hangPrompt.abort();
    hangPrompt = null;
  });
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
