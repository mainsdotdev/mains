import type { VoiceTaskLink } from "@mains/contracts/realtime";

export interface VoiceTaskDelivery {
  runId: string;
  delivery: "accepted" | "unconfirmed";
  reused?: boolean;
  messageId?: string;
  error?: string;
  nextStep?: string;
}

interface VoiceTaskNotice {
  cursor: string;
  announcement: string;
  announce: boolean;
  content: string;
}

/** Owns task admission, delivery ordering, waits and notification receipts. */
export function createVoiceTaskLifecycle(isActive: () => boolean, restored: VoiceTaskLink[]) {
  let phase: "open" | "ending" | "closed" = "open";
  let admission = 0;
  const links = new Map(restored.map((link) => [link.taskKey, link]));
  const starting = new Map<string, Promise<unknown>>();
  const unsaved = new Set<string>();
  const deliveries = new Map<string, { message: string; promise: Promise<VoiceTaskDelivery> }>();
  const sending = new Map<string, Promise<unknown>>();
  const cancellations = new Map<string, number>();
  const stopping = new Map<string, Promise<unknown>>();
  const seen = new Map<string, string>();
  const announced = new Map<string, string>();
  const pending = new Set<string>();
  const waiters = new Map<string, Set<() => void>>();
  let observe: ((runId: string) => Promise<VoiceTaskNotice>) | undefined;
  let publish: ((content: string, announce: boolean) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  let checking = Promise.resolve();
  const active = () => phase === "open" && isActive();
  const assertActive = () => {
    if (!active()) throw new Error(phase === "ending" && isActive() ? "This voice session is ending." : "This voice session has ended.");
  };

  function releaseObservers() {
    clearTimeout(timer); timer = undefined;
    for (const wakes of waiters.values()) for (const wake of [...wakes]) wake();
    waiters.clear(); pending.clear();
  }

  function changed(runId: string) {
    if (!active() || ![...links.values()].some((link) => link.id === runId)) return;
    for (const wake of [...waiters.get(runId) ?? []]) wake();
    pending.add(runId);
    if (!observe || timer) return;
    // Only event-driven, coalesced inspection; never poll unchanged workers.
    timer = setTimeout(() => {
      timer = undefined;
      const ids = [...pending]; pending.clear();
      const observed = admission;
      checking = checking.then(async () => {
        for (const id of ids) {
          if (!active() || observed !== admission) return;
          try {
            const notice = await observe!(id);
            if (!active() || observed !== admission) return;
            if (seen.get(id) === notice.cursor) continue;
            const speak = notice.announce && announced.get(id) !== notice.announcement;
            // Late reports remain useful context after the turn-end notice;
            // update quietly without repeating its spoken announcement.
            publish!(notice.content, speak);
            // A failed publication must remain eligible for a later event.
            seen.set(id, notice.cursor);
            if (speak) announced.set(id, notice.announcement);
          } catch { /* Unavailable worker, failed publication or retired session. */ }
        }
      }).catch(() => {});
    }, 1500);
    timer.unref?.();
  }

  return {
    active, assertActive, changed,
    tasks: () => [...links.values()],
    end(effect: () => Promise<void>, failed: (error: unknown) => void) {
      if (phase === "closed" || !isActive()) throw new Error("This voice session has ended.");
      if (phase === "ending") return;
      phase = "ending"; admission++; releaseObservers();
      // Return the management tool response before closing its MCP transport.
      endTimer = setTimeout(() => {
        endTimer = undefined;
        void Promise.resolve().then(() => {
          if (phase === "ending" && isActive()) return effect();
          return undefined;
        }).catch((error: unknown) => {
          if (phase !== "ending" || !isActive()) return;
          phase = "open";
          try { failed(error); } catch { /* A disconnected transport cannot receive the failure. */ }
          for (const link of links.values()) changed(link.id);
        });
      }, 250);
      endTimer.unref?.();
    },
    activate(read: (runId: string) => Promise<VoiceTaskNotice>, notify: (content: string, announce: boolean) => void) {
      if (!active()) return;
      observe = read; publish = notify;
      for (const link of links.values()) changed(link.id);
    },
    wait(runId: string, timeout: number, recheck: () => Promise<boolean>) {
      assertActive();
      return new Promise<void>((resolve) => {
        const wakes = waiters.get(runId) ?? new Set();
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          clearTimeout(waitTimer); wakes.delete(done);
          if (!wakes.size) waiters.delete(runId);
          resolve();
        };
        const waitTimer = setTimeout(done, timeout);
        wakes.add(done); waiters.set(runId, wakes);
        // Subscribe before checking again so a concurrent event cannot be lost.
        void recheck().then((different) => { if (different) done(); }).catch(done);
      });
    },
    async start<T extends object>(taskKey: string, effects: {
      create(): Promise<VoiceTaskLink>;
      persist(link: VoiceTaskLink): Promise<void>;
      read(runId: string): Promise<T>;
    }) {
      assertActive();
      const previous = starting.get(taskKey);
      if (previous) return previous;
      const job = Promise.resolve().then(async () => {
        assertActive();
        let link = links.get(taskKey);
        const reused = !!link;
        if (!link) {
          link = await effects.create();
          // A worker already admitted by the user survives voice closure.
          links.set(taskKey, link); unsaved.add(taskKey);
        }
        if (unsaved.has(taskKey)) {
          await effects.persist(link); unsaved.delete(taskKey);
        }
        return reused ? { ...await effects.read(link.id), reused: true }
          : { runId: link.id, title: link.title, status: "started", reused: false };
      });
      starting.set(taskKey, job);
      try { return await job; }
      finally { if (starting.get(taskKey) === job) starting.delete(taskKey); }
    },
    cancel<T>(runId: string, effect: () => Promise<T>): Promise<T> {
      assertActive(); cancellations.set(runId, (cancellations.get(runId) ?? 0) + 1);
      const previous = stopping.get(runId);
      if (previous) return previous as Promise<T>;
      const job = Promise.resolve().then(() => { assertActive(); return effect(); });
      stopping.set(runId, job);
      const settled = () => { if (stopping.get(runId) === job) stopping.delete(runId); };
      void job.then(settled, settled);
      return job;
    },
    deliver(runId: string, key: string, message: string, effect: (assertCurrent: () => void) => Promise<VoiceTaskDelivery>) {
      assertActive();
      const previous = deliveries.get(key);
      if (previous) {
        if (previous.message !== message) throw new Error("Use a new messageId for a different instruction.");
        return { promise: previous.promise, reused: true };
      }
      const generation = cancellations.get(runId) ?? 0;
      const admitted = admission;
      const assertCurrent = () => {
        assertActive();
        if (admitted !== admission) throw new Error("This pending instruction was canceled when the voice conversation began ending.");
        if ((cancellations.get(runId) ?? 0) !== generation) throw new Error("This pending instruction was canceled when the user stopped the task.");
      };
      const previousSend = sending.get(runId) ?? Promise.resolve();
      const stop = stopping.get(runId);
      const promise = previousSend.catch(() => {}).then(async () => { await stop; assertCurrent(); return effect(assertCurrent); });
      deliveries.set(key, { message, promise }); sending.set(runId, promise);
      const settled = () => { if (sending.get(runId) === promise) sending.delete(runId); };
      void promise.then(settled, () => {
        settled();
        // Failed preparation did not invoke the native send. Uncertain native
        // outcomes resolve explicitly and retain their delivery identity.
        if (deliveries.get(key)?.promise === promise) deliveries.delete(key);
      });
      return { promise, reused: false };
    },
    dispose() {
      phase = "closed"; clearTimeout(endTimer); releaseObservers();
    },
  };
}
