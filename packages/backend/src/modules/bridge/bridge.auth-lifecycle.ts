import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";

export class BridgeAuthCancelledError extends Error {
  constructor() { super("Sign-in was cancelled"); }
}
type Lease = { generation: number; leaving: boolean };
const rules = {
  signIn: { states: ["signed-out", "error"], error: "Bridge sign-in is already active" },
  approve: { states: ["ready"], error: "Backend approval is required" },
  requestApproval: { states: ["needs-approval"], error: "This device is not waiting for approval" },
  verify: { states: ["needs-verification"], error: "No account key is waiting for verification" },
  recover: { states: ["needs-approval", "needs-verification"], error: "Sign in on the new backend first" },
} satisfies Record<string, { states: BridgeAuthStatus["state"][]; error: string }>;

/** One owner for auth operations and their asynchronous continuations.
 * Leaving retires active/queued work immediately, then drains it before cleanup.
 * Failed cleanup stays fenced for retry; stop permanently retires this owner.
 */
export function createBridgeAuthLifecycle() {
  let state: BridgeAuthStatus["state"] = "signed-out";
  let phase: "active" | "leaving" | "stopped" = "active";
  let generation = 0, activated = false;
  let operations: Promise<unknown> = Promise.resolve();
  let operation: Lease | undefined;
  let leaving: Promise<void> | undefined;
  const current = (lease: Lease) => lease.generation === generation && phase !== "stopped" && lease.leaving === (phase === "leaving");
  function assert(lease = operation) { if (!lease || !current(lease)) throw new BridgeAuthCancelledError(); }
  function requireAction(action: keyof typeof rules) {
    assert();
    const rule = rules[action];
    if (!(rule.states as readonly string[]).includes(state)) throw new Error(rule.error);
  }
  function fence() {
    if (phase === "stopped") throw new BridgeAuthCancelledError();
    if (phase === "active") { phase = "leaving"; generation++; }
  }
  function enqueue<T>(lease: Lease, work: () => Promise<T>): Promise<T> {
    const next = operations.then(async () => {
      assert(lease); operation = lease;
      try { return await work(); } finally { operation = undefined; }
    });
    operations = next.catch(() => {});
    return next;
  }
  return {
    get state() { return state; },
    get closed() { return phase === "stopped"; },
    get leaving() { return phase === "leaving"; },
    get generation() { return generation; },
    get activated() { return activated; },
    current(revision: number) { return phase === "active" && revision === generation; },
    assert,
    require: requireAction,
    fence,
    transition(next: BridgeAuthStatus["state"]) { assert(); state = next; },
    activate() { assert(); activated = true; },
    revoke() { assert(); activated = false; state = "revoked"; },
    // The ready callback needs the durably trusted credential before it can
    // finish activation. A merely offered/pending key never satisfies this.
    canUseCredentials(trusted: boolean) { return phase === "active" && state !== "revoked" && trusted; },
    beginLogin() { requireAction("signIn"); operation!.generation = ++generation; state = "signing-in"; },
    run<T>(work: () => Promise<T>): Promise<T> {
      if (phase !== "active") return Promise.reject(new BridgeAuthCancelledError());
      return enqueue({ generation, leaving: false }, work);
    },
    async checked<T>(work: () => Promise<T>): Promise<T> {
      const lease = operation; assert(lease);
      try { const value = await work(); assert(lease); return value; }
      catch (error) { assert(lease); throw error; }
    },
    leave(work: () => Promise<void>): Promise<void> {
      if (leaving) return leaving;
      if (phase === "stopped") return Promise.reject(new BridgeAuthCancelledError());
      fence();
      const request = enqueue({ generation, leaving: true }, async () => {
        await work(); assert(); activated = false; state = "signed-out"; phase = "active";
      });
      leaving = request;
      void request.then(() => { leaving = undefined; }, () => { leaving = undefined; });
      return request;
    },
    stop() { phase = "stopped"; generation++; activated = false; state = "signed-out"; return operations; },
  };
}
