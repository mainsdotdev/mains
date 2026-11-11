export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdateInfo = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
};

export type UpdateProgress = {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
};

export type UpdateState = {
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
};


export const initialUpdateState: UpdateState = { status: "idle", info: null, progress: null, error: null };
export type UpdateEvent =
  | { type: "checking" | "available" | "not-available" }
  | { type: "downloaded"; info: UpdateInfo }
  | { type: "error"; error: string };
const eventSources: Record<Exclude<UpdateEvent["type"], "error">, readonly UpdateStatus[]> = {
  checking: ["idle", "not-available", "error"],
  available: ["checking"],
  "not-available": ["checking"],
  downloaded: ["checking", "available", "downloading"],
};

export function createUpdateLifecycle(publish: (state: UpdateState) => void) {
  let state = initialUpdateState;
  let installing = false;
  let closed = false;
  let binding: object | null = null;
  const snapshot = (): UpdateState => ({ ...state, info: state.info && { ...state.info }, progress: state.progress && { ...state.progress } });
  const change = (next: UpdateState) => { state = next; publish(snapshot()); };
  const receive = (event: UpdateEvent) => {
    if (closed) return;
    if (event.type === "error" && event.error.includes("command is disabled")) return;
    if (state.status === "downloaded") {
      if (event.type === "error") { installing = false; change({ ...state, error: event.error }); }
      return;
    }
    if (event.type !== "error" && !eventSources[event.type].includes(state.status)) return;
    if (event.type === "error") change({ ...state, status: "error", progress: null, error: event.error });
    else if (event.type === "downloaded") change({ status: "downloaded", info: event.info, progress: null, error: null });
    else change({ status: event.type, info: null, progress: null, error: null });
  };
  return {
    active: () => !closed,
    close() { closed = true; binding = null; },
    bind() {
      const scope = {}; binding = scope;
      return {
        receive(event: UpdateEvent) { if (binding === scope) receive(event); },
        close() { if (binding === scope) binding = null; },
      };
    },
    snapshot,
    receive,
    unavailable() { if (!closed) change({ status: "not-available", info: null, progress: null, error: null }); },
    check(effect: () => void) {
      if (closed) return snapshot();
      if (["checking", "available", "downloading", "downloaded"].includes(state.status)) return snapshot();
      receive({ type: "checking" });
      if (closed) return snapshot();
      try { effect(); }
      catch (error) { receive({ type: "error", error: error instanceof Error ? error.message : "Failed to check for updates" }); }
      return snapshot();
    },
    install(effect: () => void) {
      if (closed) throw new Error("Update service has shut down");
      if (state.status !== "downloaded") throw new Error("Wait for the update to finish downloading before installing");
      if (installing) return;
      installing = true;
      try { effect(); }
      catch (error) {
        installing = false;
        receive({ type: "error", error: error instanceof Error ? error.message : "Failed to install the update" });
        throw error;
      }
    },
  };
}

/** Local-shell pushes retire pending reads, including Strict Mode's first mount. */
export function createUpdateProjection(publish: (state: UpdateState) => void) {
  let active = true, revision = 0;
  let state = initialUpdateState;
  const apply = (next: UpdateState) => { state = { ...next, info: next.info && { ...next.info }, progress: next.progress && { ...next.progress } }; publish(state); };
  return {
    push(next: UpdateState) { if (active) { revision++; apply(next); } },
    read() {
      const receipt = ++revision;
      const current = () => active && receipt === revision;
      return {
        apply(next: UpdateState) { if (current()) { revision++; apply(next); } },
        fail(error: unknown) {
          if (!current()) return;
          revision++;
          apply({ ...state, status: state.status === "downloaded" ? "downloaded" : "error", error: error instanceof Error ? error.message : typeof error === "string" ? error : "Could not contact the updater" });
        },
      };
    },
    close() { active = false; revision++; },
  };
}
