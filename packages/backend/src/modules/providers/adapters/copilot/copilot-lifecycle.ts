import type { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import { ResourceCleanupError } from "../../../../runtime/resource-lifecycle";

export class CopilotCanceledError extends Error {
  constructor(message = "Copilot operation canceled") {
    super(message);
    this.name = "CopilotCanceledError";
  }
}

async function raced<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let abort!: () => void;
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (signal.aborted) throw signal.reason;
        return work();
      }), canceled,
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export interface CopilotSessionOwner {
  readonly session: CopilotSession;
  readonly signal: AbortSignal;
  readonly active: boolean;
  readonly running: boolean;
  assertActive(): void;
  begin(): void;
  run<T>(work: () => Promise<T>): Promise<T>;
  project(work: () => void | Promise<void>, cleanup?: boolean): Promise<void>;
  cancel(error?: Error): void;
  finish(): Promise<void>;
  close(): Promise<void>;
}

type ClientRecord = {
  client?: CopilotClient;
  revision: number;
  phase: "starting" | "ready" | "closing" | "blocked" | "closed";
  controller: AbortController;
  starting: Promise<void>;
  stopping?: Promise<void>;
  closing?: Promise<void>;
  stopped: boolean;
  uses: number;
  sessions: Set<CopilotSessionOwner>;
};

/** Client: starting -> ready -> closing -> closed; failed release stays blocked.
 * Session: prepared -> running -> finished -> closing -> closed (or blocked).
 * A session pins its client from SDK acquisition through successful disconnect, including the
 * preparation window before a run starts. All delayed effects use that owner. */
export function createCopilotLifecycle(options: {
  create: (cwd?: string) => Promise<CopilotClient>;
  initialize: (client: CopilotClient) => Promise<void>;
  alive: (client: CopilotClient) => Promise<boolean>;
  stop: (client: CopilotClient) => Promise<void>;
  invalidate: () => void;
}) {
  let current: ClientRecord | undefined;
  let checking: Promise<ClientRecord> | undefined;
  let shutdown: Promise<void> | undefined;
  let stopped = false;
  let revision = 0;
  const records = new Set<ClientRecord>();
  function assertRunning() {
    if (stopped) throw new CopilotCanceledError("Copilot runtime shut down");
  }
  function stopNative(record: ClientRecord): Promise<void> {
    if (!record.client || record.stopped) return Promise.resolve();
    if (record.stopping) return record.stopping;
    const pending = Promise.resolve().then(() => options.stop(record.client!)).then(() => { record.stopped = true; });
    record.stopping = pending;
    void pending.catch(() => { if (record.stopping === pending) record.stopping = undefined; });
    return pending;
  }
  function close(record: ClientRecord, error: Error): Promise<void> {
    if (record.closing) return record.closing;
    if (record.phase === "closed") return Promise.resolve();
    record.phase = "closing";
    record.controller.abort(error);
    for (const scope of record.sessions) scope.cancel(error);
    options.invalidate();
    const pending = Promise.allSettled([
      stopNative(record), record.starting.catch((error: unknown) => error),
      ...[...record.sessions].map((scope) => scope.close()),
    ]).then((results) => {
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      const startup = results[1];
      if (!record.stopped && startup.status === "fulfilled" && startup.value instanceof ResourceCleanupError) {
        errors.push(startup.value);
      }
      if (errors.length) throw new ResourceCleanupError(errors, "Copilot client cleanup failed", () => close(record, error));
      record.phase = "closed";
      records.delete(record);
      if (current === record) current = undefined;
    });
    record.closing = pending;
    void pending.catch(() => {
      if (record.closing === pending) {
        record.closing = undefined;
        record.phase = "blocked";
      }
    });
    return pending;
  }
  function create(cwd?: string, shared = true): ClientRecord {
    const record: ClientRecord = {
      revision, phase: "starting", controller: new AbortController(), stopped: false,
      uses: 0, sessions: new Set(), starting: Promise.resolve(),
    };
    records.add(record);
    if (shared) current = record;
    record.starting = Promise.resolve().then(async () => {
      try {
        assertRunning();
        record.client = await options.create(cwd);
        if (record.controller.signal.aborted) throw record.controller.signal.reason;
        assertRunning();
        await options.initialize(record.client);
        if (record.controller.signal.aborted) throw record.controller.signal.reason;
        assertRunning();
        await record.client.ping("init");
        if (record.controller.signal.aborted) throw record.controller.signal.reason;
        assertRunning();
        record.phase = "ready";
      } catch (error) {
        // Early stop unblocks startup, but startup can acquire native handles
        // after that stop completed. Join it before the final release attempt.
        if (record.controller.signal.aborted && record.stopping) {
          await record.stopping.catch(() => {});
          record.stopped = false;
          record.stopping = undefined;
        }
        try {
          await stopNative(record);
        } catch (cleanupError) {
          record.phase = "blocked";
          throw new ResourceCleanupError([error, cleanupError], "Copilot startup cleanup failed", () => close(record, new CopilotCanceledError()));
        }
        if (record.phase !== "closing") {
          record.phase = "closed";
          records.delete(record);
          if (current === record) current = undefined;
        }
        throw error;
      }
    });
    return record;
  }
  function ensure(cwd?: string): Promise<ClientRecord> {
    assertRunning();
    if (checking) return checking;
    const pending = Promise.resolve().then(async () => {
      assertRunning();
      let record = current;
      if (record) {
        if (record.phase === "blocked") throw new Error("Copilot cleanup failed; retry shutdown");
        if (record.phase === "closing") await record.closing;
        else {
          await record.starting;
          const alive = await options.alive(record.client!);
          assertRunning();
          if (record.phase === "ready" && alive && (record.revision === revision || record.uses > 0)) return record;
          await close(record, new Error("Copilot runtime connection closed"));
        }
      }
      assertRunning();
      record = create(cwd);
      await record.starting;
      assertRunning();
      return record;
    });
    checking = pending;
    const clear = () => { if (checking === pending) checking = undefined; };
    void pending.then(clear, clear);
    return pending;
  }
  function session(record: ClientRecord, acquire: () => Promise<CopilotSession>): { owner: CopilotSessionOwner; opening: Promise<void> } {
    record.uses++;
    let value: CopilotSession | undefined;
    let phase: "prepared" | "running" | "finished" | "closing" | "blocked" | "closed" = "prepared";
    let closing: Promise<void> | undefined;
    const controller = new AbortController();
    let queue = Promise.resolve();
    let projectionFailed = false;
    let projectionError: unknown;
    const opening = Promise.resolve().then(acquire).then((sdkSession) => { value = sdkSession; });
    const owner: CopilotSessionOwner = {
      get session() { if (!value) throw new Error("Copilot session is still opening"); return value; },
      get signal() { return controller.signal; },
      get active() { return !stopped && record.phase === "ready" && !controller.signal.aborted && (phase === "prepared" || phase === "running"); },
      get running() { return owner.active && phase === "running"; },
      assertActive() {
        if (!owner.active) throw controller.signal.reason ?? new Error("Copilot session closed");
      },
      begin() {
        owner.assertActive();
        if (phase !== "prepared") throw new Error("Copilot session already executed");
        phase = "running";
      },
      async run(work) {
        owner.assertActive();
        const result = await raced(controller.signal, work);
        owner.assertActive();
        return result;
      },
      project(work, cleanup = false) {
        if (!owner.running && !(cleanup && phase !== "closed")) return Promise.resolve();
        const next = queue.then(work);
        queue = next.catch((error: unknown) => {
          if (!projectionFailed) {
            projectionFailed = true;
            projectionError = error;
          }
        });
        return next;
      },
      cancel(error = new CopilotCanceledError()) {
        if (controller.signal.aborted || phase === "closed") return;
        controller.abort(error);
        if (phase === "running" && value) void value.abort().catch(() => {});
      },
      async finish() {
        if (phase === "running") phase = "finished";
        await queue;
        if (projectionFailed) throw projectionError;
      },
      close() {
        if (closing) return closing;
        if (phase === "closed") return Promise.resolve();
        owner.cancel();
        phase = "closing";
        const pending = Promise.resolve().then(async () => {
          await opening.catch(() => {});
          await queue;
          await value?.disconnect();
          phase = "closed";
          record.sessions.delete(owner);
          record.uses--;
        });
        closing = pending;
        void pending.catch(() => {
          if (closing === pending) {
            closing = undefined;
            phase = "blocked";
          }
        });
        return pending;
      },
    };
    record.sessions.add(owner);
    return { owner, opening };
  }
  async function read<T>(record: ClientRecord, work: (client: CopilotClient, check: () => void) => Promise<T>): Promise<T> {
    record.uses++;
    const check = () => {
      assertRunning();
      if (record.phase !== "ready") throw record.controller.signal.reason ?? new Error("Copilot client closed");
    };
    try {
      check();
      const result = await raced(record.controller.signal, () => work(record.client!, check));
      check();
      return result;
    } finally {
      record.uses--;
    }
  }
  return {
    restart() { revision++; },
    async open(cwd: string | undefined, acquire: (client: CopilotClient, owner: CopilotSessionOwner) => Promise<CopilotSession>): Promise<CopilotSessionOwner> {
      const record = await ensure(cwd);
      assertRunning();
      if (record.phase !== "ready") throw new Error("Copilot client closed before session acquisition");
      const { owner, opening } = session(record, () => { owner.assertActive(); return acquire(record.client!, owner); });
      try {
        await opening;
        owner.assertActive(); return owner;
      } catch (error) {
        await owner.close();
        throw error;
      }
    },
    async read<T>(work: (client: CopilotClient, check: () => void) => Promise<T>, cwd?: string): Promise<T> {
      return read(await ensure(cwd), work);
    },
    async probe<T>(work: (client: CopilotClient, check: () => void) => Promise<T>): Promise<T> {
      assertRunning();
      const record = create(undefined, false);
      try {
        await record.starting;
        return await read(record, work);
      } finally {
        await close(record, new CopilotCanceledError());
      }
    },
    shutdown(): Promise<void> {
      if (shutdown) return shutdown;
      stopped = true;
      const pending = Promise.all([...records].map((record) => close(record, new CopilotCanceledError("Copilot runtime shut down")))).then(() => {});
      shutdown = pending;
      void pending.catch(() => { if (shutdown === pending) shutdown = undefined; });
      return pending;
    },
  };
}
