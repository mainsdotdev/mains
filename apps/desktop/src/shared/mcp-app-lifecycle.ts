export interface McpAppMessagePreview {
  id: string; ownerKey: string; text: string; newConversation: boolean;
}

/** Leaving a launch's route/context retires its ticket permanently, including
 * when the user returns to exactly the same route before acquisition ends. */
export function createMcpAppLaunch(initialContext: string, initialPath: string) {
  let context = initialContext, path = initialPath, active = true, pending: object | undefined;
  return {
    bind(nextContext: string, nextPath: string) {
      active = true;
      if (context === nextContext && path === nextPath) return false;
      const retired = !!pending; pending = undefined; context = nextContext; path = nextPath; return retired;
    },
    begin() {
      const ticket = {}, current = () => active && pending === ticket;
      if (active) pending = ticket;
      return { context, path, current, finish() { if (!current()) return false; pending = undefined; return true; } };
    },
    invalidate() { pending = undefined; },
    release() { active = false; pending = undefined; },
  };
}

/** One editable request belongs to one conversation owner. Receipts from an old
 * dialog or abort signal cannot settle a replacement request. */
export function createMcpAppMessageReview(initialOwner: string, changed: (preview: McpAppMessagePreview | null) => void) {
  let owner: string | undefined = initialOwner;
  let pending: { preview: McpAppMessagePreview; resolve(text: string | null): void; removeAbort(): void } | undefined;
  function finish(id: string | undefined, text: string | null) {
    if (!pending || pending.preview.id !== id) return;
    const request = pending; pending = undefined;
    request.removeAbort(); changed(null); request.resolve(text);
  }
  function cancel() { finish(pending?.preview.id, null); }
  return {
    setOwner(next: string) { if (owner !== next) { cancel(); owner = next; } },
    release(key: string) { if (owner === key) { cancel(); owner = undefined; } },
    cancel,
    dismiss: (id: string | undefined) => finish(id, null),
    confirm(id: string | undefined, text: string) {
      const value = text.trim(); if (value && value.length <= 32_000) finish(id, value);
    },
    review(text: string, newConversation: boolean, signal?: AbortSignal, documentSignal?: AbortSignal): Promise<string | null> {
      const signals = [signal, documentSignal].filter((entry): entry is AbortSignal => !!entry);
      if (!owner || signals.some((entry) => entry.aborted)) return Promise.resolve(null);
      if (pending) return Promise.reject(new Error("Review or cancel the app's current prompt first"));
      const preview = { id: crypto.randomUUID(), ownerKey: owner, text, newConversation };
      return new Promise((resolve) => {
        const abort = () => finish(preview.id, null);
        pending = { preview, resolve, removeAbort: () => signals.forEach((entry) => entry.removeEventListener("abort", abort)) };
        signals.forEach((entry) => entry.addEventListener("abort", abort, { once: true })); changed(preview);
      });
    },
  };
}

/** One iframe document owns its connection, readiness channels and timers.
 * Standard initialization and compatibility readiness are independent. */
export function createMcpAppConnection() {
  let phase: "waiting-frame" | "connecting" | "connected" | "initialized" | "failed" | "disposed" = "waiting-frame";
  let compatibility = false;
  const deadline = Date.now() + 10_000, abort = new AbortController();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const active = () => phase !== "failed" && phase !== "disposed";
  function clear(key: string) { const timer = timers.get(key); if (timer !== undefined) clearTimeout(timer); timers.delete(key); }
  function schedule(key: string, delay: number, work: () => void) {
    clear(key); if (!active()) return;
    timers.set(key, setTimeout(() => { timers.delete(key); if (active()) work(); }, delay));
  }
  function retire(next: "failed" | "disposed") {
    phase = next; compatibility = false; abort.abort();
    for (const key of timers.keys()) clear(key);
  }
  return {
    get active() { return active(); },
    get initialized() { return phase === "initialized"; },
    get compatibilityReady() { return active() && compatibility; },
    get signal(): AbortSignal { return abort.signal; },
    assertActive() { if (!active()) throw new Error("This app connection is closed"); },
    frame(ready: boolean): "connect" | "wait" | "timeout" | "skip" {
      if (phase !== "waiting-frame") return "skip";
      clear("frame");
      if (ready) { phase = "connecting"; return "connect"; }
      if (Date.now() >= deadline) { retire("failed"); return "timeout"; }
      return "wait";
    },
    waitForFrame(work: () => void) { schedule("frame", 50, work); },
    connected() { if (!active()) return false; if (phase === "connecting") phase = "connected"; return true; },
    initialize() {
      if (!active() || phase === "waiting-frame") return false;
      phase = "initialized"; return true;
    },
    markCompatibilityReady() { if (!active()) return false; compatibility = true; return true; },
    fallback(work: () => void) { schedule("fallback", 750, () => { if (phase !== "initialized") work(); }); },
    fail() { if (!active()) return false; retire("failed"); return true; },
    dispose() { retire("disposed"); },
  };
}

/** Native sessions retain their acquiring adapter through retryable teardown.
 * Closing revokes admission immediately and claims cleanup before callbacks. */
export function createMcpAppSessions<Value>() {
  let generation = 0, draining: Promise<void> | undefined;
  const openings = new Set<Promise<unknown>>();
  const entries = new Map<string | symbol, { value?: Value; phase: "active" | "closing"; revoked: boolean;
    dispose(): Promise<unknown> | undefined; revoke(): void; closing?: Promise<void> }>();
  function close(id: string | symbol): Promise<void> {
    const entry = entries.get(id);
    if (!entry) return Promise.resolve();
    if (entry.closing) return entry.closing;
    entry.phase = "closing";
    const result = Promise.resolve().then(async () => {
      if (!entry.revoked) { entry.revoke(); entry.revoked = true; }
      await entry.dispose();
      if (entries.get(id) === entry) entries.delete(id);
    }).finally(() => { if (entry.closing === result) entry.closing = undefined; });
    entry.closing = result; return result;
  }
  return {
    open<Result>(work: (current: () => boolean) => Promise<Result>): Promise<Result> {
      if (draining) return Promise.reject(new Error("App sessions are closing"));
      const revision = generation, current = () => revision === generation && !draining;
      const job = Promise.resolve().then(() => {
        if (!current()) throw new Error("App session closed while opening");
        return work(current);
      }).finally(() => openings.delete(job));
      openings.add(job); return job;
    },
    add(id: string, value: Value, dispose: () => Promise<unknown> | undefined, revoke: () => void) {
      if (draining) throw new Error("App session closed while opening");
      if (entries.has(id)) throw new Error("App session identity is already owned");
      entries.set(id, { value, phase: "active", revoked: false, dispose, revoke });
    },
    retire(dispose: () => Promise<unknown> | undefined, revoke: () => void = () => {}) {
      const id = Symbol("unhosted app session");
      entries.set(id, { phase: "closing", revoked: false, dispose, revoke });
      return close(id);
    },
    get(id: string) {
      const entry = entries.get(id);
      if (!entry || entry.phase !== "active") throw new Error("App session expired; reopen the app");
      return entry.value as Value; // Only add() creates an active entry.
    },
    current(id: string, value: Value) { const entry = entries.get(id); return entry?.phase === "active" && entry.value === value; },
    close,
    closeAll(): Promise<void> {
      if (draining) return draining;
      generation++;
      const result = Promise.resolve().then(async () => {
        await Promise.allSettled([...openings]);
        await Promise.allSettled([...entries.keys()].map(close));
      }).finally(() => { if (draining === result) draining = undefined; });
      draining = result; return result;
    },
  };
}
