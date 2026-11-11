import type { GoalInfo, GoalSetParams } from "./adapter.types";

/** Unknown provider states stay provider-owned and are never treated as done. */
export function mapProviderGoal(raw: unknown, threadId?: string): GoalInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const goal = raw as Record<string, unknown>;
  if (typeof goal.threadId !== "string" || !goal.threadId || (threadId && goal.threadId !== threadId) ||
      typeof goal.objective !== "string" || typeof goal.status !== "string" || !goal.status) return null;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return { threadId: goal.threadId, objective: goal.objective, status: goal.status,
    tokenBudget: number(goal.tokenBudget), tokensUsed: number(goal.tokensUsed), timeUsedSeconds: number(goal.timeUsedSeconds),
    createdAt: number(goal.createdAt), updatedAt: number(goal.updatedAt) };
}

/** Only an authoritative absence or completed goal permits automatic renewal. */
export function mayEstablishProviderGoal(response: unknown, threadId: string) {
  if (!response || typeof response !== "object" || !("goal" in response)) return false;
  const raw = (response as { goal: unknown }).goal;
  return raw === null || mapProviderGoal(raw, threadId)?.status === "complete";
}

export function mayAutomaticallyClearProviderGoal(goal: GoalInfo | null) {
  return goal?.status === "complete";
}

export function providerGoalPatch(input: GoalSetParams): GoalSetParams {
  if (!input || typeof input !== "object") throw new Error("Goal update is required.");
  const origin = input.origin ?? "user";
  if (origin !== "user" && origin !== "automatic") throw new Error("Invalid goal mutation origin.");
  if (input.objective !== undefined && (typeof input.objective !== "string" || !input.objective.trim())) throw new Error("Goal objective cannot be empty.");
  if (input.status !== undefined && (typeof input.status !== "string" || !input.status.trim())) throw new Error("Goal status is required.");
  if (input.tokenBudget !== undefined && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 0)) throw new Error("Goal token budget must be a non-negative integer.");
  return { origin, ...(input.objective !== undefined ? { objective: input.objective } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}), ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}) };
}

export function relativizeGoalMentions(goal: string, rootPath: string | undefined): string {
  if (!rootPath || !goal) return goal;
  const root = rootPath.endsWith("/") ? rootPath : rootPath + "/";
  return goal.split("@" + root).join("@");
}

export interface ProviderGoalViewState { goal: GoalInfo | null; isBusy: boolean }
export const emptyProviderGoalView: ProviderGoalViewState = { goal: null, isBusy: false };
const goalIdentity = (goal: GoalInfo | null) => goal ? JSON.stringify([goal.threadId, goal.objective, goal.createdAt]) : "";

/** A view projects provider facts; it never infers a successful goal mutation
 * from a failed/null response. Reads and mutation receipts yield to live push. */
export function createProviderGoalView(effects: {
  current(): boolean;
  read(): Promise<GoalInfo | null>;
  set(params: GoalSetParams): Promise<GoalInfo | null>;
  clear(origin: "user" | "automatic"): Promise<boolean>;
  change(state: ProviderGoalViewState): void;
}) {
  let state = emptyProviderGoalView, retired = false, revision = 0, cycle = 0;
  let pending: object | undefined, attemptedCycle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => !retired && effects.current();
  const stopTimer = () => { clearTimeout(timer); timer = undefined; };
  const publish = (next: ProviderGoalViewState) => { state = next; if (current()) effects.change(next); };
  const arm = () => {
    if (!current() || timer || pending || !mayAutomaticallyClearProviderGoal(state.goal) || attemptedCycle === cycle) return;
    const expected = cycle;
    timer = setTimeout(() => {
      timer = undefined;
      if (!current() || cycle !== expected || pending || !mayAutomaticallyClearProviderGoal(state.goal)) return;
      attemptedCycle = expected;
      void command("clear", undefined, "automatic");
    }, 3000);
  };
  const apply = (goal: GoalInfo | null) => {
    const previous = state.goal;
    if (goal?.status === "complete") {
      if (previous?.status !== "complete" || goalIdentity(previous) !== goalIdentity(goal)) {
        cycle++; attemptedCycle = undefined; stopTimer();
      }
    } else { attemptedCycle = undefined; stopTimer(); }
    revision++;
    publish({ ...state, goal }); arm();
  };
  async function command(kind: "set" | "clear", params?: GoalSetParams, origin: "user" | "automatic" = "user"): Promise<boolean> {
    if (!current() || pending || !state.goal || (kind === "clear" && origin === "automatic" && !mayAutomaticallyClearProviderGoal(state.goal))) return false;
    if (params?.status === "paused" && state.goal?.status !== "active") return false;
    if (params?.status === "active" && state.goal?.status !== "paused") return false;
    if (params?.objective !== undefined && (!params.objective.trim() || state.goal?.status === "complete")) return false;
    const ticket = {}; pending = ticket;
    const atRevision = ++revision;
    stopTimer(); publish({ ...state, isBusy: true });
    try {
      if (kind === "clear") {
        const cleared = await effects.clear(origin);
        if (!current() || pending !== ticket || !cleared) return false;
        if (revision === atRevision) apply(null);
        return true;
      }
      const goal = mapProviderGoal(await effects.set(providerGoalPatch(params!)));
      if (!current() || pending !== ticket || !goal) return false;
      if (revision === atRevision) apply(goal);
      return true;
    } catch { return false; }
    finally {
      if (pending === ticket) { pending = undefined; publish({ ...state, isBusy: false }); arm(); }
    }
  }
  return {
    async load() {
      if (!current()) return;
      const atRevision = revision;
      try {
        const raw = await effects.read();
        const goal = mapProviderGoal(raw);
        if (current() && revision === atRevision && (raw === null || goal)) apply(goal);
      } catch { /* Preserve the last provider-confirmed snapshot. */ }
    },
    receive(raw: unknown) {
      if (!current()) return;
      const goal = mapProviderGoal(raw);
      if (raw !== null && !goal) return;
      if (goal && state.goal?.threadId === goal.threadId && goal.updatedAt !== undefined &&
          state.goal.updatedAt !== undefined && goal.updatedAt < state.goal.updatedAt) return;
      apply(goal);
    },
    edit: (objective: string) => command("set", { objective, origin: "user" }),
    pause: () => command("set", { status: "paused", origin: "user" }),
    resume: () => command("set", { status: "active", origin: "user" }),
    clear: () => command("clear"),
    retire() { retired = true; pending = undefined; stopTimer(); },
  };
}
