import { describe, expect, it } from "vitest";
import { allowsPrAction, createPullRequestDraft, createPullRequestLifecycle, type PrAction, type PrActionContext } from "./pull-request-lifecycle";
import { prFixture } from "../components/pull-request-test-fixtures";

const ref = { provider: "github", owner: "ACME", repo: "Widget", number: 176 };
const merge: PrAction = { kind: "merge", method: "squash" };
const ready: PrAction = { kind: "ready" };
const comment: PrAction = { kind: "comment", body: "Looks good" };
const thread = { id: "thread-1", isResolved: false, viewerCanResolve: true, viewerCanUnresolve: false,
  path: "app.ts", line: 1, side: "right" as const, comments: [] };
const context = (): PrActionContext => ({ prRef: ref, detail: { ...prFixture, reviewThreads: [thread] }, active: true, isError: false, isFetching: false });

describe("PR write eligibility", () => {
  it("authorizes a canonical live reference without treating CI as provider permission", () => {
    const ctx = context(); ctx.detail = { ...ctx.detail!, ciStatus: "failing" };
    expect(allowsPrAction(ctx, merge)).toBe(true);
  });
  it.each([
    ["missing detail", { detail: undefined }],
    ["hidden preview", { active: false }],
    ["failed refresh with cached detail", { isError: true }],
    ["refresh in flight", { isFetching: true }],
    ["different PR", { prRef: { ...ref, number: 177 } }],
    ["different repository", { prRef: { ...ref, owner: "other" } }],
    ["different provider", { prRef: { ...ref, provider: "gitlab" } }],
  ] satisfies [string, Partial<PrActionContext>][])("blocks every write from %s", (_name, patch) => {
    const ctx = { ...context(), ...patch };
    const actions: PrAction[] = [merge, ready, comment, { kind: "reply", threadId: thread.id, body: "Reply" },
      { kind: "review", path: "app.ts", line: 1, side: "right", body: "Review" }, { kind: "resolve", threadId: thread.id, resolved: true }];
    expect(actions.some((action) => allowsPrAction(ctx, action))).toBe(false);
  });
  it.each([
    ["conflicting", { mergeable: "CONFLICTING" }], ["unknown mergeability", { mergeable: "UNKNOWN" }],
    ["draft", { isDraft: true }], ["closed", { state: "closed" }], ["merged", { state: "merged" }],
  ] as const)("blocks merge for a %s PR", (_name, patch) => {
    expect(allowsPrAction({ ...context(), detail: { ...prFixture, ...patch } }, merge)).toBe(false);
  });
  it.each([
    ["open permitted draft", { isDraft: true }, true],
    ["already ready", {}, false], ["closed draft", { state: "closed", isDraft: true }, false],
    ["missing permission", { isDraft: true, viewerCanUpdate: false }, false],
    ["missing provider id", { isDraft: true, nodeId: "" }, false],
  ] as const)("marks ready only for an %s", (_name, patch, allowed) => {
    expect(allowsPrAction({ ...context(), detail: { ...prFixture, ...patch } }, ready)).toBe(allowed);
  });
  it("allows ordinary comments on merged PRs but rejects empty drafts", () => {
    const ctx = { ...context(), detail: { ...prFixture, state: "merged" as const } };
    expect(allowsPrAction(ctx, comment)).toBe(true);
    expect(allowsPrAction(ctx, { kind: "comment", body: " \n " })).toBe(false);
  });
  it("requires the current thread, its direction-specific permission and an actual transition", () => {
    const ctx = context();
    expect(allowsPrAction(ctx, { kind: "resolve", threadId: thread.id, resolved: true })).toBe(true);
    expect(allowsPrAction(ctx, { kind: "resolve", threadId: "missing", resolved: true })).toBe(false);
    expect(allowsPrAction(ctx, { kind: "resolve", threadId: thread.id, resolved: false })).toBe(false);
    ctx.detail = { ...ctx.detail!, reviewThreads: [{ ...thread, isResolved: true }] };
    expect(allowsPrAction(ctx, { kind: "resolve", threadId: thread.id, resolved: false })).toBe(false);
    ctx.detail.reviewThreads[0] = { ...thread, isResolved: true, viewerCanUnresolve: true };
    expect(allowsPrAction(ctx, { kind: "resolve", threadId: thread.id, resolved: false })).toBe(true);
  });
});

describe("PR action and draft ownership", () => {
  function owner() {
    const ctx = context();
    const lifecycle = createPullRequestLifecycle(ctx, () => true);
    lifecycle.attach(); return { ctx, lifecycle };
  }
  it("shares synchronous admission across different action kinds and releases a failure for explicit retry", () => {
    const { lifecycle } = owner();
    const ticket = lifecycle.begin(comment)!;
    expect(lifecycle.begin(merge)).toBeUndefined();
    ticket.finish();
    expect(lifecycle.begin(comment)).toBeTruthy();
  });
  it.each([merge, ready])("does not replay confirmed $kind while provider detail lags", (action) => {
    const { lifecycle, ctx } = owner();
    if (action.kind === "ready") ctx.detail = { ...prFixture, isDraft: true };
    const ticket = lifecycle.begin(action)!;
    expect(ticket.succeed()).toBe(true); ticket.finish();
    ctx.detail = { ...ctx.detail! };
    expect(lifecycle.begin(action)).toBeUndefined();
  });
  it("waits for provider-confirmed thread state before allowing its reverse transition", () => {
    const { lifecycle, ctx } = owner();
    const action: PrAction = { kind: "resolve", threadId: thread.id, resolved: true };
    const ticket = lifecycle.begin(action)!; ticket.succeed(); ticket.finish();
    expect(lifecycle.begin(action)).toBeUndefined();
    ctx.detail = { ...ctx.detail!, reviewThreads: [{ ...thread, isResolved: true, viewerCanUnresolve: true }] };
    expect(lifecycle.begin({ ...action, resolved: false })).toBeTruthy();
  });
  it("retains accepted work when hidden but suppresses its notification", () => {
    const { lifecycle, ctx } = owner(); const ticket = lifecycle.begin(comment)!;
    ctx.active = false;
    expect(ticket.current()).toBe(true); expect(ticket.visible()).toBe(false);
    expect(ticket.succeed()).toBe(true);
  });
  it("never revives a retired receipt or a pre-cleanup receipt after attachment", () => {
    const { lifecycle } = owner(); const old = lifecycle.begin(comment)!;
    lifecycle.detach(); lifecycle.attach();
    const fresh = lifecycle.begin(comment)!;
    expect(old.succeed()).toBe(false); old.finish();
    expect(fresh.current()).toBe(true);
    lifecycle.retire(); lifecycle.attach();
    expect(fresh.succeed()).toBe(false); expect(lifecycle.begin(comment)).toBeUndefined();
  });
  it("acknowledges only an unchanged mounted draft version, including edit ABA", () => {
    const draft = createPullRequestDraft(); draft.attach(); draft.edit("A");
    const old = draft.capture(); draft.edit("B"); draft.edit("A");
    expect(old.acknowledge()).toBe(false); expect(draft.snapshot()).toBe("A");
    const current = draft.capture(); expect(current.acknowledge()).toBe(true); expect(draft.snapshot()).toBe("");
    draft.edit("B"); const closed = draft.capture(); draft.detach(); draft.attach();
    expect(closed.acknowledge()).toBe(false); expect(draft.snapshot()).toBe("B");
  });
});
