import type { DriverOutcome, WorkRunEvent } from "../../../../shared/adapter.types";

type Phase = "acquiring" | "executing" | "canceling" | "finalizing" | "blocked" | "closed";
interface RunLease {
  readonly signal: AbortSignal;
  readonly phase: Phase;
  readonly done: Promise<void>;
  readonly cleanupError: unknown;
  assertActive(): void;
  acquired(session: unknown): void;
  execute(): void;
  complete(outcome: DriverOutcome): Promise<DriverOutcome>;
  publish(event: WorkRunEvent, work: () => void | Promise<void>): Promise<void>;
  receipt(work: () => void | Promise<void>): Promise<void>;
  terminal(work: () => void | Promise<void>): Promise<void>;
  abort(): void;
  close(): Promise<void>;
  finished(): void;
}

// Abort must reach the owning execution even through a replacement adapter.
// The entry is claimed before any callback/await and released by identity.
const runs = new Map<string, RunLease>();

export async function abortWorkRun(runId: string): Promise<boolean> {
  const lease = runs.get(runId);
  if (!lease) return false;
  if (lease.phase === "blocked") await lease.close();
  else lease.abort();
  return true;
}

/** Owns one execution from preparation through successful resource release.
 * Stop retires acquisition/execution; failed cleanup retains the claim for
 * retry rather than exposing a session that may still own native resources. */
export function createWorkRunLifecycle(options: {
  cleanup?: (session: unknown) => Promise<void>;
  cancelRequests: (runId: string) => void;
  shutdown?: () => Promise<void>;
}) {
  const owned = new Set<RunLease>();
  let stopped = false, driverStopped = false;
  let closing: Promise<void> | undefined, stoppingDriver: Promise<void> | undefined;
  function stopDriver(): Promise<void> {
    if (driverStopped) return Promise.resolve();
    if (stoppingDriver) return stoppingDriver;
    const pending = Promise.resolve().then(() => options.shutdown?.()).then(() => { driverStopped = true; });
    stoppingDriver = pending;
    void pending.catch(() => { if (stoppingDriver === pending) stoppingDriver = undefined; });
    return pending;
  }
  return {
    claim(runId: string): RunLease {
      if (stopped) throw new Error("Provider adapter has been shut down");
      if (runs.has(runId)) throw new Error(`Run ${runId} is already executing or awaiting cleanup`);
      const controller = new AbortController();
      let phase: Phase = "acquiring";
      let session: unknown, acquired = false, cleaned = false, canceledRequests = false;
      let closing: Promise<void> | undefined;
      let cleanupError: unknown;
      let completion: Promise<DriverOutcome> | undefined;
      let projectionFailed = false, projectionError: unknown;
      let terminal: Promise<void> | undefined;
      let queue: Promise<void> = Promise.resolve();
      const pendingWrites = new Set<Promise<void>>();
      const accepts = () => phase === "acquiring" || phase === "executing";
      function track(work: () => void | Promise<void>): Promise<void> {
        let resolve!: () => void, reject!: (error: unknown) => void;
        const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        pendingWrites.add(pending);
        const remove = () => { pendingWrites.delete(pending); };
        void pending.then(remove, (error: unknown) => {
          if (!projectionFailed) { projectionFailed = true; projectionError = error; }
          remove();
        });
        // Claim before invoking a callback that may itself call Stop.
        try { void Promise.resolve(work()).then(resolve, reject); }
        catch (error) { reject(error); }
        return pending;
      }
      function enqueue(work: () => void | Promise<void>) {
        return track(() => {
          const next = queue.then(work);
          queue = next.catch(() => {});
          return next;
        });
      }
      let finished!: () => void;
      const done = new Promise<void>((resolve) => { finished = resolve; });
      async function drain() {
        while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
      }
      const lease: RunLease = {
        get signal() { return controller.signal; },
        get phase() { return phase; },
        done,
        get cleanupError() { return cleanupError; },
        assertActive() {
          if (controller.signal.aborted || (phase !== "acquiring" && phase !== "executing")) throw new Error("Run was aborted");
        },
        acquired(value) { session = value; acquired = true; },
        execute() { lease.assertActive(); phase = "executing"; },
        complete(result) {
          if (completion) return completion;
          phase = "finalizing";
          completion = drain().then(() => {
            if (controller.signal.aborted) return { ...result, status: "canceled", summary: "Run was aborted" };
            if (projectionFailed) return { ...result, status: "failed", summary: projectionError instanceof Error ? projectionError.message : String(projectionError) };
            return result;
          });
          return completion;
        },
        publish(event, work) {
          const receipt = event.type === "artifact" && event.kind === "user-prompt" && !event.ephemeral &&
            event.metadata?.isFromSubagent !== true && typeof event.metadata?.clientUserMessageId === "string" &&
            event.metadata.clientUserMessageId.length > 0;
          if (accepts() || phase === "canceling" && receipt) return enqueue(work);
          return receipt ? Promise.reject(new Error("Run closed before confirming input delivery")) : Promise.resolve();
        },
        receipt(work) {
          if (!accepts() && phase !== "canceling") return Promise.reject(new Error("Run closed before confirming input delivery"));
          return track(work);
        },
        terminal(work) { return terminal ??= enqueue(work); },
        abort() {
          if (phase !== "acquiring" && phase !== "executing" && phase !== "canceling") return;
          phase = "canceling"; controller.abort();
        },
        close() {
          if (closing) return closing;
          if (phase === "closed") return Promise.resolve();
          phase = "finalizing";
          const pending = Promise.resolve().then(async () => {
            await drain();
            if (!cleaned && acquired) { await options.cleanup?.(session); cleaned = true; }
            if (!canceledRequests) { options.cancelRequests(runId); canceledRequests = true; }
            phase = "closed";
            if (runs.get(runId) === lease) runs.delete(runId);
            owned.delete(lease);
          });
          closing = pending;
          void pending.catch((error: unknown) => { if (closing === pending) { closing = undefined; phase = "blocked"; cleanupError = error; } });
          return pending;
        },
        finished,
      };
      runs.set(runId, lease); owned.add(lease);
      return lease;
    },
    shutdown(): Promise<void> {
      if (closing) return closing;
      stopped = true;
      const active = [...owned];
      for (const lease of active) lease.abort();
      const releases = active.map((lease) => lease.phase === "blocked" ? lease.close() : lease.done.then(() => {
        if (lease.phase === "blocked") throw lease.cleanupError;
      }));
      // Stop the native runtime while joining executions: acquisition may only
      // unblock when the provider closes. The adapter retains failed releases.
      const pending = Promise.all([stopDriver(), ...releases]).then(() => {});
      closing = pending;
      void pending.catch(() => { if (closing === pending) closing = undefined; });
      return pending;
    },
  };
}
