/** Platform-free admission and transition rules for desktop exposure and web login. */
export function createRemoteAccessCommands() {
  let tail = Promise.resolve();
  let phase: "running" | "stopping" | "stopped" = "running";
  let stopping: Promise<void> | null = null;
  let intent = 0;
  return {
    active: () => phase === "running",
    captureRestore() {
      if (phase !== "running" || intent !== 0) return null;
      const revision = intent;
      return () => phase === "running" && intent === revision;
    },
    restore(current: () => boolean, effect: (current: () => boolean) => Promise<void>): Promise<void> {
      if (!current()) return Promise.resolve();
      const job = tail.then(async () => { if (current()) await effect(() => phase === "running"); });
      tail = job.then(() => {}, () => {});
      return job;
    },
    run<T>(effect: (current: () => boolean) => Promise<T>): Promise<T> {
      if (phase !== "running") return Promise.reject(new Error("Remote access is shutting down"));
      intent++;
      const job = tail.then(() => {
        if (phase !== "running") throw new Error("Remote access is shutting down");
        return effect(() => phase === "running");
      });
      tail = job.then(() => {}, () => {});
      return job;
    },
    shutdown(effect: () => Promise<void>): Promise<void> {
      if (stopping) return stopping;
      if (phase === "stopped") return Promise.resolve();
      phase = "stopping";
      const job = tail.then(effect).then(() => { phase = "stopped"; });
      stopping = job;
      tail = job.then(() => {}, () => {});
      void job.finally(() => { if (stopping === job) stopping = null; }).catch(() => {});
      return job;
    },
  };
}

/** Cleanup claims before native effects and retains failed ownership for retry. */
export function createRemoteAccessCleanup<Resource extends object>() {
  let owned: Resource | null = null;
  let pending: Promise<void> | null = null;
  return {
    owns: (resource: Resource | null) => resource !== null && owned === resource,
    release(resource: Resource, effect: () => Promise<void>): Promise<void> {
      if (pending && owned === resource) return pending;
      if (owned && owned !== resource) return Promise.reject(new Error("Another remote-access resource still needs cleanup"));
      owned = resource;
      const job = Promise.resolve().then(effect).then(() => { if (owned === resource) owned = null; });
      pending = job;
      void job.finally(() => { if (pending === job) pending = null; }).catch(() => {});
      return job;
    },
  };
}

export interface RemoteAwakeState {
  enabled: boolean;
  remoteAccess: boolean;
  tailscale: boolean;
  onBatteryPower: boolean;
  hostReady?: boolean;
}

export function shouldKeepRemoteHostAwake(state: RemoteAwakeState): boolean {
  return state.enabled && state.hostReady !== false && (state.remoteAccess || state.tailscale) && !state.onBatteryPower;
}

export function createRemoteAwakeLease() {
  let id: number | null = null;
  return {
    reconcile(needed: boolean, native: { isStarted(id: number): boolean; start(): number; stop(id: number): void }) {
      if (needed) {
        if (id === null || !native.isStarted(id)) id = native.start();
      } else if (id !== null) {
        if (native.isStarted(id)) native.stop(id);
        id = null;
      }
    },
  };
}

/** The deadline owns settlement, even when the underlying fetch ignores abort. */
export function runWebLoginExchange(
  effect: (signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
  timeoutMs = 8000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (success: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (!success) { controller.abort(); reject(error); }
      else resolve();
    };
    const cancel = () => finish(false, new Error("Browser login canceled"));
    const timer = setTimeout(() => finish(false, new Error("Browser login timed out")), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    try { void effect(controller.signal).then(() => finish(true), (error) => finish(false, error)); }
    catch (error) { finish(false, error); }
  });
}

/** Login success/failure releases the socket once; retirement never releases it. */
export function createWebLoginHandoff() {
  let phase: "idle" | "exchanging" | "released" | "retired" = "idle";
  let pending: Promise<void> | null = null;
  const controller = new AbortController();
  const close = () => { phase = "retired"; controller.abort(); };
  return {
    close,
    run(exchange: (signal: AbortSignal) => Promise<void>, connect: () => void, current: () => boolean) {
      if (pending) return pending;
      if (phase !== "idle") return Promise.resolve();
      phase = "exchanging";
      const job = Promise.resolve().then(() => {
        if (phase === "exchanging") return exchange(controller.signal);
        return undefined;
      }).catch(() => {
        // The normal socket refusal/offline state communicates failed login.
      }).then(() => {
        if (phase === "exchanging" && current()) { phase = "released"; connect(); }
        else if (phase === "exchanging") close();
      });
      pending = job;
      void job.finally(() => { if (pending === job) pending = null; }).catch(() => {});
      return job;
    },
  };
}
