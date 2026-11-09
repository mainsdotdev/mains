import type { GoalInfo, GoalMutationOrigin, GoalSetParams } from "../../../../../shared/adapter.types";
import { mapProviderGoal, mayAutomaticallyClearProviderGoal, mayEstablishProviderGoal, providerGoalPatch, relativizeGoalMentions } from "../../../../../shared/provider-goal-lifecycle";
import type { CodexAppServer } from "./codex-app-server.client";
import type { CodexAppServerParams } from "./codex-app-server-protocol/rpc";

type GoalServer = Pick<CodexAppServer, "sendRequest">;

/** One native thread owns ordered goal reads/writes. Run admission preserves
 * click order through asynchronous persisted-thread lookup; server retirement
 * prevents queued work or late replies from acquiring a replacement server. */
export function createCodexGoalLifecycle(effects: {
  ensureServer(): Promise<GoalServer>;
  getRunningServer(): GoalServer | null;
  resolveThread(runId: string): Promise<string | undefined>;
  findRunId(threadId: string): string | null;
  publish(runId: string, goal: GoalInfo | null): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  unavailable(error: unknown): boolean;
}) {
  let generation = 0, closed = false;
  const tails = new Map<string, Promise<unknown>>();
  const observations = new Map<string, { revision: number; goal?: GoalInfo | null }>();
  const ordered = <T>(key: string, fallback: T, action: (generation: number) => Promise<T>): Promise<T> => {
    const version = generation;
    const next = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(() =>
      closed || generation !== version ? fallback : action(version));
    tails.set(key, next);
    const done = () => { if (tails.get(key) === next) tails.delete(key); };
    void next.then(done, done);
    return next;
  };
  const inThread = <T>(threadId: string, fallback: T, action: (version: number, slot: { revision: number; goal?: GoalInfo | null }) => Promise<T>) =>
    ordered("thread:" + threadId, fallback, async (version) => {
      const slot = { revision: 0, goal: undefined as GoalInfo | null | undefined };
      observations.set(threadId, slot);
      try { return await action(version, slot); }
      finally { if (observations.get(threadId) === slot) observations.delete(threadId); }
    });
  const active = (server: GoalServer, version: number) => !closed && generation === version && effects.getRunningServer() === server;
  const resolve = async (runId: string, version: number, start: boolean) => {
    const threadId = await effects.resolveThread(runId);
    if (!threadId || closed || generation !== version) return null;
    const server = start ? await effects.ensureServer() : effects.getRunningServer();
    if (!server || !active(server, version)) return null;
    return { server, threadId, current: async () => active(server, version) && await effects.resolveThread(runId) === threadId && active(server, version) };
  };
  const reconcile = async (owner: NonNullable<Awaited<ReturnType<typeof resolve>>>, slot: { revision: number; goal?: GoalInfo | null }) => {
    let goal = slot.goal ?? null, revision = slot.revision;
    // A notification during a mutation can precede or follow that mutation.
    // A causal read after it resolves that ambiguity, even with coarse clocks.
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!await owner.current()) return { goal: null, revision: slot.revision };
        revision = slot.revision;
        const result = await owner.server.sendRequest("thread/goal/get", { threadId: owner.threadId });
        const next = mapProviderGoal(result.goal, owner.threadId);
        if (result.goal !== null && !next) throw new Error("Invalid provider goal snapshot");
        goal = next;
        if (slot.revision === revision) break;
      }
    } catch (error) {
      effects.warn("Goal reconciliation failed:", error);
      goal = slot.goal ?? null; revision = slot.revision;
    }
    return { goal, revision };
  };
  return {
    serverClosed() { generation++; tails.clear(); observations.clear(); },
    shutdown() { closed = true; generation++; tails.clear(); observations.clear(); },
    establish(server: GoalServer, threadId: string | undefined, enabled: boolean, objective: string | undefined, root: string | undefined, overwrite: boolean) {
      if (!enabled || !threadId || !objective?.trim()) return Promise.resolve();
      return inThread(threadId, undefined, async (version) => {
        if (!active(server, version)) return;
        let renewing = false;
        if (!overwrite) {
          try {
            const existing = await server.sendRequest("thread/goal/get", { threadId });
            if (!mayEstablishProviderGoal(existing, threadId)) return;
            renewing = mapProviderGoal(existing.goal, threadId)?.status === "complete";
          } catch (error) { effects.warn("thread/goal/get failed; preserving existing goal:", error); return; }
        }
        if (!active(server, version)) return;
        await server.sendRequest("thread/goal/set", { threadId, objective: relativizeGoalMentions(objective, root), origin: "automatic", ...(renewing ? { status: "active" as const } : {}) })
          .catch((error: unknown) => effects.warn("thread/goal/set failed:", error));
      });
    },
    set(runId: string, params: GoalSetParams): Promise<GoalInfo | null> {
      return ordered("run:" + runId, null, async (version) => {
        try {
          const patch = providerGoalPatch(params);
          const owner = await resolve(runId, version, true); if (!owner) return null;
          return await inThread(owner.threadId, null, async (_version, slot) => {
            if (!await owner.current()) return null;
            const before = slot.revision;
            const result = await owner.server.sendRequest("thread/goal/set", { ...patch, threadId: owner.threadId } as CodexAppServerParams<"thread/goal/set">);
            if (!await owner.current()) return null;
            const response = mapProviderGoal(result.goal, owner.threadId);
            const snapshot = slot.revision !== before ? await reconcile(owner, slot) : { goal: response, revision: slot.revision };
            if (!await owner.current()) return null;
            const goal = slot.revision !== snapshot.revision ? slot.goal ?? null : snapshot.goal;
            if (goal || (slot.revision !== before && slot.goal === null)) effects.publish(runId, goal);
            return goal;
          });
        } catch (error) { effects.error("setGoal failed:", error); return null; }
      });
    },
    get(runId: string): Promise<GoalInfo | null> {
      return ordered("run:" + runId, null, async (version) => {
        try {
          const owner = await resolve(runId, version, false); if (!owner) return null;
          return await inThread(owner.threadId, null, async (_version, slot) => {
            if (!await owner.current()) return null;
            const result = await owner.server.sendRequest("thread/goal/get", { threadId: owner.threadId });
            const received = slot.revision;
            return await owner.current() ? slot.revision !== received ? slot.goal ?? null : mapProviderGoal(result.goal, owner.threadId) : null;
          });
        } catch (error) { if (!effects.unavailable(error)) effects.error("getGoal failed:", error); return null; }
      });
    },
    clear(runId: string, origin: GoalMutationOrigin = "user"): Promise<boolean> {
      return ordered("run:" + runId, false, async (version) => {
        try {
          if (origin !== "user" && origin !== "automatic") return false;
          const owner = await resolve(runId, version, true); if (!owner) return false;
          return await inThread(owner.threadId, false, async (_version, slot) => {
            if (!await owner.current()) return false;
            if (origin === "automatic") {
              const existing = await owner.server.sendRequest("thread/goal/get", { threadId: owner.threadId });
              if (!mayAutomaticallyClearProviderGoal(mapProviderGoal(existing.goal, owner.threadId)) || !await owner.current()) return false;
            }
            const before = slot.revision;
            const result = await owner.server.sendRequest("thread/goal/clear", { threadId: owner.threadId, origin });
            if (!await owner.current()) return false;
            if (result.cleared === true) {
              const snapshot = slot.revision !== before ? await reconcile(owner, slot) : { goal: null, revision: slot.revision };
              if (!await owner.current()) return false;
              const goal = slot.revision !== snapshot.revision ? slot.goal ?? null : snapshot.goal;
              effects.publish(runId, goal);
            }
            return result.cleared === true;
          });
        } catch (error) { effects.error("clearGoal failed:", error); return false; }
      });
    },
    notification(server: GoalServer, method: string, params: unknown) {
      if (closed || effects.getRunningServer() !== server || !params || typeof params !== "object") return;
      const payload = params as { threadId?: unknown; goal?: unknown };
      const goal = mapProviderGoal(payload.goal);
      const threadId = typeof payload.threadId === "string" ? payload.threadId : goal?.threadId;
      if (!threadId || (goal && goal.threadId !== threadId)) return;
      if (method !== "thread/goal/cleared" && (method !== "thread/goal/updated" || !goal)) return;
      const slot = observations.get(threadId);
      if (slot) { slot.revision++; slot.goal = method === "thread/goal/cleared" ? null : goal; }
      const runId = effects.findRunId(threadId); if (!runId) return;
      if (method === "thread/goal/updated" && goal) effects.publish(runId, goal);
      else if (method === "thread/goal/cleared") effects.publish(runId, null);
    },
  };
}
