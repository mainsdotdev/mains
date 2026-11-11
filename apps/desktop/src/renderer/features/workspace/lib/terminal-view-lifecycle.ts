import { CHANNELS } from "@mains/contracts/channels";
import type { Transport } from "@/lib/transport/types";
import type { TerminalSnapshot } from "@mains/contracts/terminal";

/** Attachment is a view lifetime; it never owns a persistent workspace PTY. */
export function createTerminalAttachment() {
  let phase: "attaching" | "ready" | "exited" | "disconnected" | "disposed" = "attaching";
  let revision = 0, exitCode: number | null = null;
  return {
    get alive() { return phase !== "disposed"; },
    get ready() { return phase === "ready"; },
    get exitCode() { return exitCode; },
    begin() {
      if (phase === "disposed") return null;
      const attempt = ++revision;
      phase = "attaching"; exitCode = null;
      return { current: () => phase !== "disposed" && revision === attempt };
    },
    restore(snapshot: TerminalSnapshot) {
      exitCode = exitCode ?? snapshot.session.exitCode;
      phase = exitCode === null && snapshot.session.status === "running" ? "ready" : "exited";
    },
    exit(code: number) {
      if (phase === "disposed" || phase === "disconnected" || phase === "exited") return false;
      exitCode = code; phase = "exited"; return true;
    },
    disconnect() { if (phase !== "disposed") { revision++; phase = "disconnected"; } },
    dispose() { revision++; phase = "disposed"; },
  };
}

export function validateTerminalSnapshot(value: unknown, id: string): asserts value is TerminalSnapshot {
  const snapshot = value as TerminalSnapshot | undefined;
  if (!snapshot || snapshot.session?.id !== id || typeof snapshot.data !== "string" ||
    !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 ||
    !["running", "exited"].includes(snapshot.session.status) ||
    (snapshot.session.exitCode !== null && !Number.isSafeInteger(snapshot.session.exitCode))) {
    throw new Error("Could not connect to terminal. Restart Mains and try again.");
  }
}

/** An input attempt is admitted before invoking native code. Rerender and
 * reconnect observers join its outcome instead of submitting another command. */
export function createTerminalCommand() {
  const attempts = new WeakMap<Transport, Map<string, ReturnType<Transport["invoke"]>>>();
  return {
    send(transport: Transport, id: string, command: string, instanceId?: string) {
      let pending = attempts.get(transport);
      if (!pending) { pending = new Map(); attempts.set(transport, pending); }
      const key = JSON.stringify([id, command]);
      const existing = pending.get(key);
      if (existing) return existing;
      const result = Promise.resolve().then(() => transport.invoke(CHANNELS.terminal.write,
        [id, `${command}\r`, { commandId: "provider-login", ...(instanceId ? { instanceId } : {}) }]));
      pending.set(key, result);
      return result;
    },
  };
}

interface TemporaryTerminal {
  references: number;
  retired: boolean;
  command: ReturnType<typeof createTerminalCommand>;
  connect(force?: boolean): ReturnType<Transport["invoke"]>;
  stop(): Promise<void>;
}
const temporaryTerminals = new WeakMap<Transport, Map<string, TemporaryTerminal>>();

/** The temporary PTY belongs to its live views, including Strict Mode replay.
 * A replacement waits for the previous owner's late acquisition and cleanup. */
export function acquireTemporaryTerminal(transport: Transport, id: string, cwd?: string) {
  let terminals = temporaryTerminals.get(transport);
  if (!terminals) { terminals = new Map(); temporaryTerminals.set(transport, terminals); }
  let owner = terminals.get(id);
  if (!owner || owner.retired) {
    const previous = owner;
    const pending = new Set<ReturnType<Transport["invoke"]>>();
    const instances = new Set<string>();
    let latest: ReturnType<Transport["invoke"]> | undefined;
    let stopping: Promise<void> | undefined, stopped = false;
    const entry: TemporaryTerminal = {
      references: 0, retired: false, command: createTerminalCommand(),
      connect(force = false) {
        if (entry.retired) return Promise.reject(new Error("Terminal view is closed"));
        if (latest && !force) return latest;
        const task = Promise.resolve().then(async () => {
          await previous?.stop();
          if (entry.retired) throw new Error("Terminal view is closed");
          const result = await transport.invoke(CHANNELS.terminal.create, [{ id, cwd }]);
          if (result.success) {
            const instanceId = (result.data as { session?: { instanceId?: unknown } } | undefined)?.session?.instanceId;
            if (typeof instanceId === "string" && instanceId) instances.add(instanceId);
          }
          return result;
        });
        latest = task; pending.add(task);
        void task.then(() => release(), () => release());
        function release() { pending.delete(task); if (latest === task) latest = undefined; }
        return task;
      },
      stop() {
        entry.retired = true;
        if (stopped) return Promise.resolve();
        if (stopping) return stopping;
        stopping = Promise.resolve().then(async () => {
          await Promise.allSettled([...pending]);
          for (const instanceId of instances.size ? instances : [undefined]) {
            const result = await transport.invoke(CHANNELS.terminal.destroy, instanceId ? [id, instanceId] : [id]);
            if (!result.success) throw new Error(result.error);
          }
          stopped = true;
          if (terminals!.get(id) === entry) terminals!.delete(id);
        }).finally(() => { stopping = undefined; });
        return stopping;
      },
    };
    owner = entry; terminals.set(id, entry);
  }
  const entry = owner;
  entry.references++;
  let released = false;
  return {
    command: entry.command,
    connect: entry.connect,
    release() {
      if (released) return;
      released = true; entry.references--;
      // React's immediate effect replay reacquires the same owner first.
      void Promise.resolve().then(() => {
        if (!entry.references) return entry.stop();
        return undefined;
      }).catch(() => console.warn("Could not close temporary terminal"));
    },
  };
}
