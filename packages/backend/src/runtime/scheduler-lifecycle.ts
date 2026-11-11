/** Claims execution before any preparation or callback can reenter the service. */
export function createSchedulerLifecycle<T>() {
  const pending = new Map<string, Promise<T | null>>();
  const owners = new Map<string, object>();
  const timers = new Map<string, { handle?: ReturnType<typeof setTimeout> }>();
  const retries = new Map<string, { attempts: number; at: number }>();
  let phase: "idle" | "running" | "stopped" = "idle";
  let generation = 0;
  let stopping: Promise<void> | undefined;
  function cancel(key: string) { clearTimeout(timers.get(key)?.handle); timers.delete(key); }
  return {
    get running() { return phase === "running"; },
    capture() { const revision = generation; return () => phase === "running" && generation === revision; },
    retryAt(id: string) { return retries.get(id)?.at ?? 0; },
    start() { if (phase === "running") return false; phase = "running"; generation++; stopping = undefined; return true; },
    stop() {
      if (stopping) return stopping;
      phase = "stopped"; generation++;
      for (const key of timers.keys()) cancel(key);
      return stopping = Promise.allSettled([...pending.values()]).then(() => {});
    },
    cancel,
    schedule(key: string, due: number, fire: () => void) {
      cancel(key);
      if (phase !== "running" || !Number.isFinite(due)) return;
      due = Math.max(due, retries.get(key)?.at ?? 0);
      const revision = generation, timer: { handle?: ReturnType<typeof setTimeout> } = {};
      timers.set(key, timer);
      const arm = () => {
        timer.handle = setTimeout(() => {
          if (phase !== "running" || generation !== revision || timers.get(key) !== timer) return;
          if (Date.now() < due) { arm(); return; }
          timers.delete(key); fire();
        }, Math.min(0x7fffffff, Math.max(0, due - Date.now())));
        timer.handle.unref();
      };
      arm();
    },
    invalidate(id: string) { owners.delete(id); },
    run(id: string, work: (current: () => boolean) => Promise<T | null>, settled?: () => void): Promise<T | null> {
      if (phase === "stopped") return Promise.reject(new Error("Scheduler is stopped"));
      const existing = pending.get(id);
      if (existing) return existing;
      const revision = generation, owner = {};
      const current = () => phase !== "stopped" && generation === revision && owners.get(id) === owner;
      owners.set(id, owner);
      const result = Promise.resolve().then(() => current() ? work(current) : null).then((value) => {
        retries.delete(id); return value;
      }, (error: unknown) => {
        const attempts = (retries.get(id)?.attempts ?? 0) + 1;
        retries.set(id, { attempts, at: Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5)) });
        throw error;
      }).finally(() => {
        pending.delete(id); if (owners.get(id) === owner) owners.delete(id);
        if (phase === "running") settled?.();
      });
      pending.set(id, result);
      return result;
    },
  };
}
