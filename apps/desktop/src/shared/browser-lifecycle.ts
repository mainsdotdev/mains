/** Platform-free ownership rules for native browser operations. */
export function canPresentBrowserView(attached: boolean, visible: boolean, suppressionCount: number): boolean {
  return attached && visible && suppressionCount === 0;
}

export function createBrowserOperationLifecycle() {
  let generation = 0;
  const claims = new Map<string, object>();
  return {
    retire(key?: string) {
      if (key !== undefined) claims.delete(key);
      else { generation++; claims.clear(); }
    },
    begin(key: string, valid: () => boolean, options: { replaceScope?: boolean } = {}) {
      if (!valid()) return null;
      if (options.replaceScope) { generation++; claims.clear(); }
      const ticket = {};
      const epoch = generation;
      claims.set(key, ticket);
      return {
        current: () => generation === epoch && claims.get(key) === ticket && valid(),
        release() { if (claims.get(key) === ticket) claims.delete(key); },
      };
    },
  };
}

export type BrowserDownloadState = "progressing" | "paused" | "completed" | "cancelled" | "interrupted";

export function restoredBrowserDownloadState(value: unknown): BrowserDownloadState | null {
  switch (value) {
    case "progressing": case "paused": return "interrupted";
    case "completed": case "cancelled": case "interrupted": return value;
    default: return null;
  }
}

/** Native interruption updates may resume. Only done settles ownership. */
export function createBrowserDownloadLifecycle() {
  let phase: "active" | "canceling" | "settled" = "active";
  return {
    update(interrupted: boolean, paused: boolean): BrowserDownloadState | null {
      if (phase !== "active") return null;
      return paused ? "paused" : interrupted ? "interrupted" : "progressing";
    },
    finish(state: "completed" | "cancelled" | "interrupted"): BrowserDownloadState | null {
      if (phase === "settled") return null;
      phase = "settled";
      return state;
    },
    cancel() { if (phase !== "active") return false; phase = "canceling"; return true; },
    rejectCancel() { if (phase !== "canceling") return false; phase = "active"; return true; },
  };
}

/** Self-contained: also serialized into the isolated guest page. */
export function createBrowserCaptureLifecycle() {
  const scope = `${Date.now()}-${Math.random()}`;
  let sequence = 0;
  let active = true;
  let pending: string | null = null;
  const current = (id: string | undefined) => active && pending !== null && pending === id;
  return {
    live: () => active,
    pending: () => pending !== null,
    current,
    begin() {
      if (!active || pending !== null) return null;
      pending = `${scope}:${++sequence}`;
      return pending;
    },
    finish(id: string | undefined) { if (!current(id)) return false; pending = null; return true; },
    dispose() { active = false; pending = null; },
  };
}
