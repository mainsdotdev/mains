export type RealtimeVoicePhase = "idle" | "connecting" | "connected" | "ending" | "stop_failed" | "error";

interface VoiceClosure<Attempt> {
  attempt: Attempt;
  error?: string;
  request?: Promise<void>;
  closed: Promise<void>;
  confirmClosed: () => void;
}

/** Owns call transitions independently of media and transport callbacks.
 *
 * connecting -> connected requires native and media readiness in the controller.
 * Either open phase -> ending releases media once, retaining native ownership.
 * ending -> stop_failed retains that same closure for retry; only a successful
 * stop or matching native closed event releases it. Old completions cannot
 * change a replacement call. An error is terminal only after confirmed closure.
 */
export function createRealtimeVoiceLifecycle<Attempt extends object>(options: {
  releaseMedia: (attempt: Attempt) => void;
  unsubscribe: (attempt: Attempt) => void;
  stopNative: (attempt: Attempt) => Promise<void>;
  transition: (phase: RealtimeVoicePhase, attempt?: Attempt, error?: string) => void;
}) {
  let active: Attempt | undefined;
  let closing: VoiceClosure<Attempt> | undefined;

  function complete(closure: VoiceClosure<Attempt>) {
    if (closing !== closure) return;
    closing = undefined;
    options.unsubscribe(closure.attempt);
    options.transition(closure.error ? "error" : "idle", closure.attempt, closure.error);
    closure.confirmClosed();
  }

  function confirm(closure: VoiceClosure<Attempt>): Promise<void> {
    return closure.request ??= (async () => {
      try {
        await Promise.race([options.stopNative(closure.attempt), closure.closed]);
        complete(closure);
      } catch (error) {
        if (closing !== closure) return;
        const detail = error instanceof Error ? error.message : String(error);
        options.transition("stop_failed", closure.attempt,
          `The microphone is off, but voice chat closure could not be confirmed. Retry ending voice chat. ${detail}`);
      } finally { closure.request = undefined; }
    })();
  }

  function end(attempt: Attempt, error?: string) {
    if (active !== attempt) return Promise.resolve();
    // Retire ownership before media teardown can synchronously fire callbacks.
    active = undefined;
    let confirmClosed!: () => void;
    const closed = new Promise<void>((resolve) => { confirmClosed = resolve; });
    const closure = { attempt, error, closed, confirmClosed };
    closing = closure;
    options.releaseMedia(attempt);
    options.transition("ending", attempt, error);
    return confirm(closure);
  }

  return {
    get active() { return active; },
    get owned() { return active !== undefined || closing !== undefined; },
    current: (attempt: Attempt) => active === attempt,
    start(attempt: Attempt) {
      if (active !== undefined || closing !== undefined) return false;
      active = attempt;
      options.transition("connecting", attempt);
      return true;
    },
    connected(attempt: Attempt) {
      if (active === attempt) options.transition("connected", attempt);
    },
    end,
    closed(attempt: Attempt) {
      if (closing?.attempt === attempt) { complete(closing); return; }
      if (active !== attempt) return;
      active = undefined;
      options.releaseMedia(attempt);
      options.unsubscribe(attempt);
      options.transition("idle", attempt);
    },
    async settleStart(attempt: Attempt) {
      if (closing?.attempt === attempt) await confirm(closing);
      else await options.stopNative(attempt).catch(() => {});
    },
    async stop() {
      if (active !== undefined) { await end(active); return; }
      if (!closing) { options.transition("idle"); return; }
      const closure = closing;
      closure.error = undefined;
      options.transition("ending", closure.attempt);
      await confirm(closure);
    },
  };
}
