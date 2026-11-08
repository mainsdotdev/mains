import type { PluginScope } from "./adapter.types";

export type PluginMutation = { pluginId: string } & (
  | { type: "install"; scope?: PluginScope }
  | { type: "uninstall" }
  | { type: "setEnabled"; enabled: boolean }
  | { type: "update" }
);
type Outcome = { status: "succeeded" } | { status: "failed"; error: unknown };
interface MutationOwner {
  request: Readonly<PluginMutation>;
  phase: "running" | "succeeded" | "failed" | "retired";
}

/** One provider scope: idle -> running -> succeeded/failed -> idle. Retirement
 * closes admission and notifications, while issued work keeps its claim until
 * settlement. Request arguments are captured before the first await. Different
 * plugins proceed independently. Retirement does not cancel issued native work. */
export function createPluginMutationLifecycle(options: {
  isCurrent?(): boolean;
  changed?(): void;
  settled?(request: Readonly<PluginMutation>, outcome: Outcome): void;
} = {}) {
  const pending = new Map<string, MutationOwner>();
  let retired = false;
  const active = () => !retired && (options.isCurrent?.() ?? true);
  return {
    get active() { return active(); },
    pending(pluginId: string) { return active() ? pending.get(pluginId)?.request : undefined; },
    async run(request: PluginMutation, work: (request: Readonly<PluginMutation>) => Promise<void>): Promise<void> {
      if (!active()) throw new Error("Plugin actions are no longer active.");
      if (pending.has(request.pluginId)) throw new Error(`Plugin "${request.pluginId}" already has an operation in progress.`);
      const owner: MutationOwner = { request: { ...request }, phase: "running" };
      pending.set(request.pluginId, owner);
      options.changed?.();
      let outcome: Outcome;
      try { await work(owner.request); outcome = { status: "succeeded" }; }
      catch (error) { outcome = { status: "failed", error }; }
      owner.phase = active() ? outcome.status : "retired";
      if (pending.get(owner.request.pluginId) === owner) pending.delete(owner.request.pluginId);
      if (active()) { options.changed?.(); options.settled?.(owner.request, outcome); }
      if (outcome.status === "failed") throw outcome.error;
    },
    retire() {
      retired = true;
      for (const owner of pending.values()) owner.phase = "retired";
    },
  };
}
