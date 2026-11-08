import { randomUUID } from "node:crypto";
import { ResourceCleanupError } from "../../../../runtime/resource-lifecycle";
import type { OpenCodeAcpServer } from "./opencode-acp";

export class OpenCodeCanceledError extends Error {}
export type OpenCodeConnection = Pick<OpenCodeAcpServer, "isRunning" | "sendRequest" | "sendNotification" | "respond" | "respondError">;
export interface OpenCodeResourceScope {
  readonly signal: AbortSignal;
  check(): void;
  defer(release: () => void | Promise<void>): void;
}
export interface OpenCodeRuntimeScope extends OpenCodeResourceScope {
  readonly native: OpenCodeAcpServer;
  readonly connection: OpenCodeConnection;
  listen(handler: (method: string, params: unknown) => void): () => void;
  requests(handler: (id: number | string, method: string, params: unknown) => void): void;
  beforeStop(release: () => void | Promise<void>): void;
  begin(sessionId: string, handlers: PromptHandlers): OpenCodePromptOwner;
  close(): Promise<void>;
}
interface Bridge { start(): Promise<void>; stop(): Promise<void> }
interface PromptHandlers {
  onNotification(method: string, params: unknown): void;
  onRequest(id: number | string, method: string, params: unknown): void;
}
export interface OpenCodePromptOwner {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly running: boolean;
  readonly done: Promise<void>;
  project(work: () => void | Promise<void>): Promise<void>;
  cancel(error?: Error): void;
  drain(): Promise<void>;
  finish(): Promise<void>;
}

/** Runtime: starting -> ready -> closing -> closed; failed release stays blocked.
 * Runs own private ACP/bridge pairs; discovery, CLI controls and generation have
 * independent owners. Prompt: running -> draining -> closed, including final
 * writes in its done barrier. Only successful cleanup releases a run claim;
 * checkpoints retain unfinished cleanup and native-dependent files for retry. */
export function createOpenCodeLifecycle(options: {
  create: () => OpenCodeAcpServer;
  initialize: (scope: OpenCodeRuntimeScope) => Promise<void>;
  retired: () => void;
}) {
  type Owned = {
    client?: OpenCodeAcpServer;
    bridge?: Bridge;
    runId?: string;
    phase: "starting" | "ready" | "closing" | "blocked" | "closed";
    controller: AbortController;
    scope: OpenCodeRuntimeScope;
    opening: Promise<void>;
    operations: Set<Promise<unknown>>;
    before: Array<() => void | Promise<void>>;
    releases: Array<() => void | Promise<void>>;
    nativeStopped: boolean;
    bridgeStopped: boolean;
    stopping?: Promise<void>;
    interrupt?: Promise<void>;
    releasing?: Promise<void>;
    closing?: Promise<void>;
    prompt?: { sessionId: string; owner: OpenCodePromptOwner; handlers: PromptHandlers };
  };
  const records = new Set<Owned>();
  const runs = new Map<string, Owned>();
  let discovery: Owned | undefined;
  let starting: Promise<Owned> | undefined;
  let closing: Promise<void> | undefined;
  let stopped = false;
  function checkAdmission() {
    if (stopped) throw new OpenCodeCanceledError("OpenCode driver is shut down");
  }
  function active(record: Owned) {
    return !stopped && !record.controller.signal.aborted && (record.phase === "starting" || record.phase === "ready");
  }
  function finish(record: Owned) {
    record.phase = "closed"; records.delete(record);
    if (record.runId && runs.get(record.runId) === record) runs.delete(record.runId);
    if (discovery === record) discovery = undefined;
  }
  function stopNative(record: Owned): Promise<void> {
    if (record.nativeStopped) return Promise.resolve();
    if (record.stopping) return record.stopping;
    const pending = Promise.resolve().then(() => record.client?.stop()).then(() => { record.nativeStopped = true; });
    record.stopping = pending;
    void pending.catch(() => { if (record.stopping === pending) record.stopping = undefined; });
    return pending;
  }
  function release(record: Owned): Promise<void> {
    if (record.releasing) return record.releasing;
    const pending = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      try { while (record.before.length) { await record.before.at(-1)!(); record.before.pop(); } }
      catch (error) { errors.push(error); }
      try { await (record.interrupt ?? stopNative(record)); } catch (error) { errors.push(error); }
      try {
        if (record.bridge && !record.bridgeStopped) { await record.bridge.stop(); record.bridgeStopped = true; }
      } catch (error) { errors.push(error); }
      // Temporary directories depend on native close; a failed kill must not
      // release a cwd while its process can still recreate files there.
      if (record.nativeStopped) {
        try { while (record.releases.length) { await record.releases.at(-1)!(); record.releases.pop(); } }
        catch (error) { errors.push(error); }
      }
      if (errors.length) throw new ResourceCleanupError(errors, "OpenCode resource cleanup failed", () => close(record));
    });
    record.releasing = pending;
    void pending.catch(() => { if (record.releasing === pending) record.releasing = undefined; });
    return pending;
  }
  function close(record: Owned): Promise<void> {
    if (record.closing) return record.closing;
    if (record.phase === "closed") return Promise.resolve();
    record.phase = "closing";
    record.controller.abort(new OpenCodeCanceledError("OpenCode runtime closed"));
    // A run must stop issuing MCP work while accepted projections drain. Its
    // bridge is released after the prompt's done barrier. Temporary generation
    // and discovery retain the client for their bounded session cleanup first.
    if (record.bridge && record.before.length === 0) {
      record.interrupt = stopNative(record);
      void record.interrupt.catch(() => {});
    }
    if (discovery === record) options.retired();
    const pending = Promise.resolve().then(async () => {
      await record.opening.catch(() => {});
      while (record.operations.size) await Promise.allSettled([...record.operations]);
      await record.prompt?.owner.done;
      await release(record);
      finish(record);
    });
    record.closing = pending;
    void pending.catch(() => {
      if (record.closing === pending) { record.closing = undefined; record.phase = "blocked"; }
    });
    return pending;
  }
  function create(client: boolean, bridge?: Bridge, runId?: string): Owned {
    checkAdmission();
    const record: Owned = {
      client: client ? options.create() : undefined, bridge, runId, phase: "starting", controller: new AbortController(),
      opening: Promise.resolve(), operations: new Set(), before: [], releases: [],
      nativeStopped: !client, bridgeStopped: !bridge, scope: undefined!,
    };
    const listeners = new Set<(method: string, params: unknown) => void>();
    let requestHandler: ((id: number | string, method: string, params: unknown) => void) | undefined;
    const scope: OpenCodeRuntimeScope = {
      get native() { if (!record.client) throw new Error("OpenCode control task has no ACP client"); return record.client; },
      get signal() { return record.controller.signal; },
      check() {
        checkAdmission();
        if (!active(record)) throw record.controller.signal.reason ?? new Error("OpenCode runtime closed");
      },
      defer(callback) { record.releases.push(callback); },
      beforeStop(callback) { record.before.push(callback); },
      listen(handler) { listeners.add(handler); return () => { listeners.delete(handler); }; },
      requests(handler) { requestHandler = handler; },
      begin(sessionId, handlers) {
        scope.check();
        if (record.phase !== "ready" || record.prompt) throw new Error("OpenCode session already has an active prompt or finalization");
        const cancellation = new AbortController();
        let phase: "running" | "draining" | "closed" = "running";
        let failed = false;
        let error: unknown;
        let queue = Promise.resolve();
        let finishing: Promise<void> | undefined;
        let resolveDone!: () => void;
        const done = new Promise<void>((resolve) => { resolveDone = resolve; });
        const onCancel = () => owner.cancel(scope.signal.reason);
        const owner: OpenCodePromptOwner = {
          id: randomUUID(), done,
          get signal() { return cancellation.signal; },
          get running() { return phase === "running" && active(record) && !cancellation.signal.aborted; },
          project(work) {
            if (!owner.running) return Promise.resolve();
            queue = queue.then(work).catch((failure: unknown) => { if (!failed) { failed = true; error = failure; } });
            return queue;
          },
          cancel(reason = new OpenCodeCanceledError("OpenCode prompt canceled")) { cancellation.abort(reason); },
          async drain() { if (phase === "running") phase = "draining"; await queue; if (failed) throw error; },
          finish() {
            if (finishing) return finishing;
            finishing = owner.drain().finally(() => {
              phase = "closed";
              scope.signal.removeEventListener("abort", onCancel);
              if (record.prompt?.owner === owner) record.prompt = undefined;
              resolveDone();
            });
            return finishing;
          },
        };
        scope.signal.addEventListener("abort", onCancel, { once: true });
        record.prompt = { sessionId, owner, handlers };
        return owner;
      },
      connection: {
        get isRunning() { return active(record) && !!record.client?.isRunning; },
        async sendRequest(method, params, timeout, signal) {
          scope.check();
          return scope.native.sendRequest(method, params, timeout, signal ?? scope.signal);
        },
        sendNotification(method, params) { scope.check(); scope.native.sendNotification(method, params); },
        respond(id, result) { if (active(record) && record.client?.isRunning) record.client.respond(id, result); },
        respondError(id, code, message) { if (active(record) && record.client?.isRunning) record.client.respondError(id, code, message); },
      },
      close: () => close(record),
    };
    record.scope = scope;
    records.add(record);
    if (runId) runs.set(runId, record);
    record.client?.setNotificationHandler((method, params) => {
      if (!active(record)) return;
      for (const handler of listeners) handler(method, params);
      const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
      if (record.prompt?.owner.running && sessionId === record.prompt.sessionId) record.prompt.handlers.onNotification(method, params);
    });
    record.client?.setRequestHandler((id, method, params) => {
      if (!active(record)) return;
      const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
      if (record.prompt?.owner.running && sessionId === record.prompt.sessionId) record.prompt.handlers.onRequest(id, method, params);
      else if (requestHandler) requestHandler(id, method, params);
      else if (method === "elicitation/create") scope.connection.respond(id, { action: "cancel" });
      else scope.connection.respondError(id, -32000, "No active OpenCode session for this request");
    });
    record.client?.setOnClose((error) => {
      if (record.phase !== "ready") return;
      record.controller.abort(error ?? new Error("OpenCode ACP process closed"));
      void close(record).catch(() => {});
    });
    record.opening = Promise.resolve().then(async () => {
      try {
        scope.check();
        await bridge?.start(); scope.check();
        if (record.client) await options.initialize(scope);
        scope.check(); record.phase = "ready";
      } catch (error) {
        record.phase = "closing"; record.controller.abort(error);
        try { await release(record); }
        catch (cleanupError) {
          record.phase = "blocked";
          throw new ResourceCleanupError([error, cleanupError], "OpenCode startup cleanup failed", () => close(record));
        }
        if (!record.closing) finish(record);
        throw error;
      }
    });
    return record;
  }
  async function run<T>(record: Owned, work: (scope: OpenCodeRuntimeScope) => Promise<T>): Promise<T> {
    record.scope.check();
    const pending = Promise.resolve().then(async () => {
      record.scope.check(); const value = await work(record.scope); record.scope.check(); return value;
    });
    record.operations.add(pending);
    const remove = () => { record.operations.delete(pending); };
    void pending.then(remove, remove);
    return pending;
  }
  async function ensureDiscovery(): Promise<Owned> {
    checkAdmission();
    if (starting) return starting;
    const pending = Promise.resolve().then(async () => {
      if (discovery) {
        if (discovery.phase === "blocked") throw new Error("OpenCode discovery cleanup failed; retry shutdown");
        if (discovery.phase === "ready" && discovery.client?.isRunning) return discovery;
        await close(discovery);
      }
      checkAdmission(); const record = create(true); discovery = record;
      await record.opening; return record;
    });
    starting = pending;
    const clear = () => { if (starting === pending) starting = undefined; };
    void pending.then(clear, clear);
    return pending;
  }
  async function temporary<T>(native: boolean, work: (scope: OpenCodeRuntimeScope) => Promise<T>): Promise<T> {
    const record = create(native);
    let value!: T;
    try { await record.opening; value = await run(record, work); }
    finally { if (record.phase !== "blocked") await close(record); }
    checkAdmission();
    return value;
  }
  function shutdown(): Promise<void> {
    if (closing) return closing;
    stopped = true; options.retired();
    // Retire every record before joining a parent that may await a CLI probe.
    const pending = Promise.allSettled([...records].map(close)).then((results) => {
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (errors.length) throw new ResourceCleanupError(errors, "OpenCode shutdown cleanup failed", shutdown);
    });
    closing = pending;
    void pending.catch(() => { if (closing === pending) closing = undefined; });
    return pending;
  }
  return {
    check: checkAdmission,
    forRun(runId: string) { return runs.get(runId)?.scope; },
    async acquire<B extends Bridge, T>(runId: string, bridge: () => B, work: (scope: OpenCodeRuntimeScope, bridge: B) => Promise<T>): Promise<T> {
      checkAdmission();
      if (runs.has(runId)) throw new Error(`OpenCode run ${runId} already owns a runtime or pending cleanup`);
      const resource = bridge(); const record = create(true, resource, runId);
      try { await record.opening; return await run(record, (scope) => work(scope, resource)); }
      catch (error) {
        if (record.phase === "blocked" && error instanceof ResourceCleanupError) throw error;
        try { await close(record); }
        catch (cleanupError) { throw new ResourceCleanupError([error, cleanupError], "OpenCode acquisition cleanup failed", () => close(record)); }
        throw error;
      }
    },
    async shared<T>(work: (scope: OpenCodeRuntimeScope) => Promise<T>): Promise<T> { return run(await ensureDiscovery(), work); },
    temporary: <T>(work: (scope: OpenCodeRuntimeScope) => Promise<T>) => temporary(true, work),
    control: <T>(work: (scope: OpenCodeResourceScope) => Promise<T>) => temporary(false, work),
    shutdown,
  };
}
