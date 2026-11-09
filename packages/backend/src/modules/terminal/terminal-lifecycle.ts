/** Native process ownership, independent of renderer attachment. A failed
 * stop keeps ownership and remains retryable; exited shells retain replay. */
export function createTerminalLifecycle() {
  let phase: "running" | "failed" | "stopping" | "exited" | "destroyed" = "running";
  let activity = 0;
  const commands = new Map<string, { data: string; sent: boolean }>();
  return {
    get running() { return phase === "running"; },
    get attachable() { return phase === "running" || phase === "exited"; },
    get revision() { return activity; },
    touch() { activity++; },
    fail() { if (phase !== "exited" && phase !== "destroyed") phase = "failed"; activity++; },
    input(data: string, write: () => void, commandId?: string): void {
      if (commandId) {
        const previous = commands.get(commandId);
        if (previous) {
          if (previous.data !== data) throw new Error("Terminal command identity was already used");
          if (!previous.sent) throw new Error("Terminal command delivery is unconfirmed; inspect the terminal before starting sign-in again");
          return;
        }
      }
      if (phase !== "running") {
        if (commandId) throw new Error("Terminal no longer accepts commands");
        return;
      }
      if (commandId) {
        if (commands.size >= 32) throw new Error("Too many one-shot commands in this terminal");
        // Native write may accept bytes before throwing: uncertainty stays spent.
        commands.set(commandId, { data, sent: false });
      }
      activity++;
      write();
      if (commandId) commands.get(commandId)!.sent = true;
    },
    exit(): boolean {
      if (phase !== "running" && phase !== "failed" && phase !== "stopping") return false;
      phase = "exited"; activity++; return true;
    },
    destroy(kill: () => void): boolean {
      if (phase === "destroyed" || phase === "stopping") return false;
      if (phase !== "exited") {
        const previous = phase;
        phase = "stopping";
        try { kill(); }
        catch (error) {
          // A synchronous native exit is authoritative even if kill then fails.
          if ((phase as string) !== "exited") { phase = previous; throw error; }
        }
      }
      phase = "destroyed"; activity++; return true;
    },
  };
}

/** One poll timer and one query for the current catalog observer. Native probes
 * may finish after retirement; they cannot publish or clear a newer query. */
export function createTerminalMonitor<T>(effects: {
  enabled(): boolean;
  hasTargets(): boolean;
  read(): Promise<T>;
  apply(result: T): boolean;
}) {
  let observer: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: { promise: Promise<void> } | null = null;
  let generation = 0;
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  function schedule() {
    if (!effects.hasTargets()) { clearTimer(); return; }
    if (!effects.enabled() || !observer || timer || active) return;
    timer = setTimeout(() => { timer = null; void refresh().catch(() => {}); }, 2500);
    timer.unref();
  }
  function stop() { generation++; observer = null; active = null; clearTimer(); }
  function refresh(): Promise<void> {
    if (active) return active.promise;
    if (!effects.enabled() || !effects.hasTargets()) return Promise.resolve();
    clearTimer();
    const revision = generation, job = { promise: Promise.resolve() };
    active = job;
    job.promise = Promise.resolve().then(async () => {
      if (revision !== generation) return;
      const result = await effects.read();
      if (revision === generation && effects.apply(result)) observer?.();
    }).finally(() => {
      if (active !== job) return;
      active = null; schedule();
    });
    return job.promise;
  }
  return {
    refresh, stop, targetsChanged: schedule,
    watch(callback: () => void) {
      stop(); observer = callback; const revision = generation; schedule();
      return () => { if (generation === revision) stop(); };
    },
  };
}
