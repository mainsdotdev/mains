import type { WindowRequest } from "./window-request";

/** Platform-free transition rules for desktop window recovery and handoff. */
export interface CrashLoopGuard {
  record(now: number): boolean;
  reset(): void;
}

export function createCrashLoopGuard(limit = 3, windowMs = 60_000): CrashLoopGuard {
  let crashes: number[] = [];
  return {
    record(now) {
      crashes = [...crashes.filter((at) => now - at < windowMs), now];
      return crashes.length < limit;
    },
    reset() { crashes = []; },
  };
}

interface RecoveryPrompt {
  kind: "crash" | "hang";
  signal: AbortSignal;
}

export function createWindowRecoveryLifecycle(guard = createCrashLoopGuard()) {
  let closed = false;
  let restarting = false;
  let pending: { ticket: RecoveryPrompt; controller: AbortController } | null = null;
  function dismiss() {
    const previous = pending;
    pending = null;
    previous?.controller.abort();
  }
  function prompt(kind: RecoveryPrompt["kind"]): RecoveryPrompt {
    const controller = new AbortController();
    const ticket = { kind, signal: controller.signal };
    pending = { ticket, controller };
    return ticket;
  }
  return {
    crashed(reason: string, now: number): "ignore" | "reload" | RecoveryPrompt {
      if (pending?.ticket.kind === "hang") dismiss();
      if (closed || reason === "clean-exit") return "ignore";
      const intentional = restarting && reason === "killed";
      restarting = false;
      if (intentional || pending) return "ignore";
      return guard.record(now) ? "reload" : prompt("crash");
    },
    hung(): RecoveryPrompt | null {
      return closed || pending ? null : prompt("hang");
    },
    responsive() { if (pending?.ticket.kind === "hang") dismiss(); },
    respond(ticket: RecoveryPrompt, response: number): "ignore" | "quit" | "restart" | "reload" {
      if (closed || pending?.ticket !== ticket) return "ignore";
      dismiss();
      if (ticket.kind === "hang") {
        if (response !== 1) return "ignore";
        restarting = true;
        return "restart";
      }
      if (response === 1) { closed = true; return "quit"; }
      guard.reset();
      return "reload";
    },
    reject(ticket: RecoveryPrompt): boolean {
      if (closed || pending?.ticket !== ticket) return false;
      dismiss();
      return true;
    },
    close() { closed = true; dismiss(); },
  };
}

/** Claim before opening/pinging a window: both effects can reenter delivery. */
export function createWindowRequestMailbox(ttlMs = 60_000) {
  let parked: { request: WindowRequest; at: number } | null = null;
  return {
    park(request: WindowRequest, now: number) {
      const snapshot = request.kind === "openRun" ? { ...request, run: { ...request.run } } : { ...request };
      const ticket = { request: snapshot, at: now };
      parked = ticket;
      return ticket;
    },
    cancel(ticket: object) { if (parked === ticket) parked = null; },
    take(now: number): WindowRequest | null {
      const current = parked;
      parked = null;
      return current && now - current.at <= ttlMs ? current.request : null;
    },
  };
}

/** Pings coalesce while collection/delivery is pending. Release retires late
 * replies permanently; a failed read can be retried by another ping. */
export function createWindowRequestDelivery<Request>() {
  let active = true;
  let dirty = false;
  let pending: Promise<void> | null = null;
  return {
    collect(read: () => Promise<Request | null>, deliver: (request: Request) => void | Promise<unknown>) {
      dirty = true;
      if (pending) return pending;
      const job = Promise.resolve().then(async () => {
        while (active && dirty) {
          dirty = false;
          let request: Request | null;
          try { request = await read(); }
          catch { continue; }
          if (active && request !== null) await deliver(request);
        }
      });
      pending = job;
      void job.finally(() => { if (pending === job) pending = null; }).catch(() => {});
      return job;
    },
    close() { active = false; dirty = false; },
  };
}

/** A save may hand off only from its still-mounted flow. Admission stays
 * closed through a deferred view-transition callback, not just the RPC. */
export function createOnboardingCompletionLifecycle() {
  let phase: "idle" | "saving" | "presenting" | "complete" | "closed" = "idle";
  let claim: object | null = null;
  return {
    mount() { claim = null; phase = "idle"; },
    close() { claim = null; phase = "closed"; },
    busy: () => phase !== "idle",
    begin() {
      if (phase !== "idle") return null;
      const ticket = {};
      claim = ticket;
      phase = "saving";
      const current = () => claim === ticket && phase !== "closed" && phase !== "complete";
      return {
        current,
        saved() { if (!current()) return false; phase = "presenting"; return true; },
        commit() {
          if (!current() || phase !== "presenting") return false;
          phase = "complete";
          return true;
        },
        fail() { if (!current()) return false; claim = null; phase = "idle"; return true; },
      };
    },
  };
}

/** Only this launch's mounted content can overrule its boot announcement. */
export function createWindowStartupLifecycle(showSplash = false) {
  let onboarding = true;
  let contentReady = false;
  let splashRequested = false;
  let finished = false;
  return {
    needsOnboarding: () => onboarding,
    update(next: boolean, ready: boolean) {
      if (contentReady && !ready) return { accepted: false, showSplash: false };
      onboarding = next;
      if (ready) contentReady = true;
      const open = !next && !ready && showSplash && !splashRequested && !finished;
      if (open) splashRequested = true;
      return { accepted: true, showSplash: open };
    },
    finish() {
      if (finished) return false;
      finished = true;
      contentReady = true;
      return true;
    },
  };
}

/** Native geometry effects serialize, retaining the original workspace until
 * restoration succeeds. A failed entry retries its incomplete presentation. */
export function createWindowPresentationLifecycle<Snapshot>() {
  let phase: "new" | "entering" | "onboarding" | "restoring" | "workspace" | "closed" = "new";
  let workspace: Snapshot | null = null;
  let initialized = false;
  let pending = 0;
  let operation = Promise.resolve();
  return {
    initialized: () => initialized,
    temporary: () => phase !== "workspace" || pending > 0,
    enter(capture: (first: boolean) => Snapshot): Snapshot | null {
      if (phase === "closed" || phase === "onboarding") return null;
      workspace ??= capture(!initialized);
      initialized = true;
      phase = "entering";
      return workspace;
    },
    entered(snapshot: Snapshot) { if (phase === "entering" && workspace === snapshot) phase = "onboarding"; },
    restore() { if (phase !== "closed") phase = "restoring"; return workspace; },
    restored(snapshot: Snapshot | null) {
      if (phase !== "closed" && workspace === snapshot) { workspace = null; initialized = true; phase = "workspace"; }
    },
    enqueue(effect: () => Promise<void>): Promise<void> {
      if (phase === "closed") return Promise.resolve();
      pending++;
      operation = operation.catch(() => {}).then(async () => { if (phase !== "closed") await effect(); });
      return operation.finally(() => { pending--; });
    },
    close() { phase = "closed"; },
  };
}
