import { ResourceCleanupError } from "../../../../runtime/resource-lifecycle";

interface CursorServer {
  readonly isRunning: boolean;
  stop(): Promise<void>;
  setOnClose(handler: (error?: Error) => void): void;
}

interface CursorBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CursorPromptOwner {
  readonly signal: AbortSignal;
  readonly running: boolean;
  readonly done: Promise<void>;
  run<T>(work: () => Promise<T>): Promise<T>;
  project(work: () => void | Promise<void>): Promise<void>;
  cancel(error?: Error): void;
  drain(): Promise<void>;
  finish(): Promise<void>;
}

export interface CursorRunOwner<S> {
  readonly server: S | undefined;
  assertActive(): void;
  begin(sessionId: string, handlers: CursorPromptHandlers): CursorPromptOwner;
  cancel(error?: Error): void;
  close(): Promise<void>;
}

async function withSignal<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let abort!: () => void;
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    const value = await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return work();
    }), canceled]);
    if (signal.aborted) throw signal.reason;
    return value;
  } finally { signal.removeEventListener("abort", abort); }
}

interface CursorPromptHandlers {
  onNotification(method: string, params: unknown): void;
  onRequest(id: number | string, method: string, params: unknown): void;
}

export class CursorCanceledError extends Error {}

/** Runtime: starting -> ready -> closing -> closed; failed release stays blocked.
 * Run: acquiring -> prepared -> running -> finalizing -> prepared; close retains
 * the bridge until successful release. Each prompt has its own cancellation and
 * projection queue, so a retired callback cannot enter the next prompt.
 * Shutdown fences admission first, then joins startup, all run bridges and each
 * prompt's done barrier (including final output), alongside native stop. */
export function createCursorLifecycle<S extends CursorServer>(options: {
  create: () => S;
  initialize: (server: S, check: () => void) => Promise<void>;
  ready: (server: S) => void;
  retired: () => void;
}) {
  type Record = {
    server: S;
    phase: "starting" | "ready" | "closing" | "blocked" | "closed";
    controller: AbortController;
    opening: Promise<void>;
    stopping?: Promise<void>;
    closing?: Promise<void>;
    stopped: boolean;
  };
  const records = new Set<Record>();
  const runs = new Map<string, CursorRunOwner<S>>();
  const prompts = new Map<S, Map<string, { owner: CursorPromptOwner; handlers: CursorPromptHandlers }>>();
  let current: Record | undefined;
  let starting: Promise<S> | undefined;
  let closing: Promise<void> | undefined;
  let stopped = false;
  function assertRunning() {
    if (stopped) throw new CursorCanceledError("Cursor runtime shut down");
  }
  function stop(record: Record): Promise<void> {
    if (record.stopped) return Promise.resolve();
    if (record.stopping) return record.stopping;
    const pending = Promise.resolve().then(() => record.server.stop()).then(() => { record.stopped = true; });
    record.stopping = pending;
    void pending.catch(() => { if (record.stopping === pending) record.stopping = undefined; });
    return pending;
  }
  function close(record: Record): Promise<void> {
    if (record.closing) return record.closing;
    if (record.phase === "closed") return Promise.resolve();
    record.phase = "closing";
    record.controller.abort(new CursorCanceledError("Cursor runtime closed"));
    const owners = [...runs.values()].filter((owner) => owner.server === record.server);
    for (const owner of owners) owner.cancel(record.controller.signal.reason);
    if (current === record) options.retired();
    const pending = Promise.allSettled([
      stop(record), record.opening.catch((error: unknown) => error), ...owners.map((owner) => owner.close()),
    ]).then((results) => {
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      const startup = results[1];
      if (!record.stopped && startup.status === "fulfilled" && startup.value instanceof ResourceCleanupError) errors.push(startup.value);
      if (errors.length) throw new ResourceCleanupError(errors, "Cursor runtime cleanup failed", () => close(record));
      record.phase = "closed";
      records.delete(record);
      if (current === record) current = undefined;
    });
    record.closing = pending;
    void pending.catch(() => {
      if (record.closing === pending) { record.closing = undefined; record.phase = "blocked"; }
    });
    return pending;
  }
  function create(shared: boolean): Record {
    assertRunning();
    const record: Record = {
      server: options.create(), phase: "starting", controller: new AbortController(),
      opening: Promise.resolve(), stopped: false,
    };
    records.add(record);
    if (shared) current = record;
    const check = () => {
      assertRunning();
      if (record.controller.signal.aborted) throw record.controller.signal.reason;
    };
    record.server.setOnClose((error) => {
      if (record.phase !== "ready" && record.phase !== "starting") return;
      record.controller.abort(error ?? new Error("Cursor ACP process closed"));
      if (record.phase === "ready") void close(record).catch(() => {});
    });
    record.opening = Promise.resolve().then(async () => {
      try {
        check();
        await options.initialize(record.server, check);
        check();
        if (!record.server.isRunning) throw new Error("Cursor ACP process closed during initialization");
        if (shared) options.ready(record.server);
        record.phase = "ready";
      } catch (error) {
        // Early stop interrupts pending RPCs. A late start can acquire handles
        // after it, so startup must also finish its final release.
        if (record.controller.signal.aborted && record.stopping) {
          await record.stopping.catch(() => {});
          record.stopped = false; record.stopping = undefined;
        }
        try { await stop(record); }
        catch (cleanupError) {
          record.phase = "blocked";
          throw new ResourceCleanupError([error, cleanupError], "Cursor startup cleanup failed", () => close(record));
        }
        if (record.phase !== "closing") {
          record.phase = "closed"; records.delete(record);
          if (current === record) current = undefined;
        }
        throw error;
      }
    });
    return record;
  }
  async function ensure(): Promise<S> {
    assertRunning();
    if (starting) return starting;
    const pending = Promise.resolve().then(async () => {
      assertRunning();
      if (current) {
        if (current.phase === "blocked") throw new Error("Cursor cleanup failed; retry shutdown");
        if (current.phase === "ready" && current.server.isRunning) return current.server;
        await close(current);
      }
      assertRunning();
      const record = create(true);
      await record.opening;
      assertRunning();
      return record.server;
    });
    starting = pending;
    const clear = () => { if (starting === pending) starting = undefined; };
    void pending.then(clear, clear);
    return pending;
  }
  function shutdown(): Promise<void> {
    if (closing) return closing;
    if (!stopped) options.retired();
    stopped = true;
    for (const owner of runs.values()) owner.cancel();
    const pending = Promise.allSettled([
      ...[...records].map(close), ...[...runs.values()].map((owner) => owner.close()),
    ]).then((results) => {
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (errors.length) throw new ResourceCleanupError(errors, "Cursor shutdown cleanup failed", shutdown);
    });
    closing = pending;
    void pending.catch(() => { if (closing === pending) closing = undefined; });
    return pending;
  }
  return {
    assertRunning,
    signal(server: S): AbortSignal {
      const record = [...records].find((record) => record.server === server);
      if (!record) throw new CursorCanceledError("Cursor server released");
      return record.controller.signal;
    },
    check(server: S): void {
      assertRunning();
      const record = [...records].find((record) => record.server === server);
      if (!record || record.phase !== "ready" || !server.isRunning) throw record?.controller.signal.reason ?? new Error("Cursor server closed");
    },
    ensure,
    ownerFor(server: S, sessionId: unknown): CursorPromptHandlers | undefined {
      if (current?.server !== server || current.phase !== "ready" || !server.isRunning) return;
      const active = [...(prompts.get(server)?.entries() ?? [])].filter(([, entry]) => entry.owner.running);
      if (typeof sessionId === "string") return active.find(([id]) => id === sessionId)?.[1].handlers;
      return active.length === 1 ? active[0][1].handlers : undefined;
    },
    async acquire<B extends CursorBridge, T>(runId: string, createBridge: () => B, work: (bridge: B, server: S, owner: CursorRunOwner<S>) => Promise<T>): Promise<T> {
      assertRunning();
      if (runs.has(runId)) throw new Error(`Cursor run ${runId} already owns a session or pending cleanup`);
      const bridge = createBridge();
      let server: S | undefined;
      const controller = new AbortController();
      let release: Promise<void> | undefined;
      let phase: "acquiring" | "prepared" | "running" | "finalizing" | "closing" | "blocked" | "closed" = "acquiring";
      let activePrompt: CursorPromptOwner | undefined;
      const owner: CursorRunOwner<S> = {
        get server() { return server; },
        assertActive() {
          assertRunning();
          if (controller.signal.aborted || !["acquiring", "prepared", "running"].includes(phase)) throw controller.signal.reason ?? new Error("Cursor session closed");
        },
        begin(id, handlers) {
          owner.assertActive();
          if (phase !== "prepared" || !server?.isRunning) throw new Error("Cursor session is not prepared");
          const active = prompts.get(server) ?? new Map();
          if (active.has(id)) throw new Error("Cursor session already has an active prompt");
          const native = server;
          const cancellation = new AbortController();
          let accepting = true;
          let queue = Promise.resolve();
          let projectionFailed = false;
          let projectionError: unknown;
          let finishing: Promise<void> | undefined;
          let resolveDone!: () => void;
          const done = new Promise<void>((resolve) => { resolveDone = resolve; });
          const onCancel = () => prompt.cancel(controller.signal.reason);
          const prompt: CursorPromptOwner = {
            done,
            get signal() { return cancellation.signal; },
            get running() { return accepting && !stopped && !controller.signal.aborted && !cancellation.signal.aborted; },
            async run(work) {
              if (!prompt.running) throw cancellation.signal.reason ?? new Error("Cursor prompt closed");
              return withSignal(cancellation.signal, work);
            },
            project(work) {
              if (!prompt.running) return Promise.resolve();
              queue = queue.then(work).catch((error: unknown) => {
                if (!projectionFailed) { projectionFailed = true; projectionError = error; }
              });
              return queue;
            },
            cancel(error = new CursorCanceledError("Cursor prompt canceled")) { cancellation.abort(error); },
            async drain() {
              accepting = false;
              if (active.get(id)?.owner === prompt) active.delete(id);
              if (active.size === 0 && prompts.get(native) === active) prompts.delete(native);
              if (phase === "running") phase = "finalizing";
              await queue;
              if (projectionFailed) throw projectionError;
            },
            finish() {
              if (finishing) return finishing;
              finishing = prompt.drain().finally(() => {
                controller.signal.removeEventListener("abort", onCancel);
                if (activePrompt === prompt) {
                  activePrompt = undefined;
                  if (phase === "finalizing") phase = "prepared";
                }
                resolveDone();
              });
              return finishing;
            },
          };
          controller.signal.addEventListener("abort", onCancel, { once: true });
          phase = "running"; activePrompt = prompt;
          active.set(id, { owner: prompt, handlers }); prompts.set(server, active);
          return prompt;
        },
        cancel(error = new CursorCanceledError("Cursor run canceled")) { controller.abort(error); },
        close() {
          if (release) return release;
          if (phase === "closed") return Promise.resolve();
          owner.cancel(); phase = "closing";
          const prompt = activePrompt;
          const pending = Promise.resolve().then(async () => {
            await opening.catch(() => {});
            await prompt?.done;
            await bridge.stop();
            phase = "closed";
            if (runs.get(runId) === owner) runs.delete(runId);
          });
          release = pending;
          void pending.catch(() => { if (release === pending) { release = undefined; phase = "blocked"; } });
          return pending;
        },
      };
      runs.set(runId, owner);
      const opening = Promise.resolve().then(async () => {
        owner.assertActive();
        await bridge.start();
        owner.assertActive();
        server = await ensure();
        owner.assertActive();
        const result = await work(bridge, server, owner);
        owner.assertActive();
        phase = "prepared";
        return result;
      });
      try { return await opening; }
      catch (error) {
        try { await owner.close(); }
        catch (cleanupError) {
          throw new ResourceCleanupError([error, cleanupError], "Cursor acquisition cleanup failed", () => owner.close());
        }
        throw error;
      }
    },
    async probe(): Promise<S> {
      const record = create(false);
      await record.opening;
      return record.server;
    },
    async release(server: S): Promise<void> {
      const record = [...records].find((record) => record.server === server);
      if (record) await close(record);
    },
    shutdown,
  };
}
