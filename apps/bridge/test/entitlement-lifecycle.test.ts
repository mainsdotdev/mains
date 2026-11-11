import { expect, it, vi } from "vitest";
import { createBridgeSubscriptions, type EntitlementRow } from "../src/subscriptions";

const active: EntitlementRow = { source: "subscription", plan_id: "standard", billing_interval: "monthly", status: "active", starts_at: 1000, expires_at: 1000000 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }
function fixture(read: (accountId: string) => Promise<{ results: EntitlementRow[] }>, now = () => 2000) {
  const all = vi.fn(read);
  const database = { prepare: () => ({ bind: (account: string) => ({ all: () => all(account) }) }) } as unknown as NonNullable<Parameters<typeof createBridgeSubscriptions>[0]["AUTH_DB"]>;
  return { reader: createBridgeSubscriptions({ AUTH_DB: database }, now), all };
}

it("does not release a stale upload grant after invalidation during its D1 read", async () => {
  const old = deferred<{ results: EntitlementRow[] }>();
  const f = fixture(() => old.promise);
  f.all.mockReturnValueOnce(old.promise).mockResolvedValue({ results: [{ ...active, status: "revoked" }] });
  const pending = f.reader.status("account");
  f.reader.invalidate("account");
  old.resolve({ results: [active] });
  expect((await pending).subscription).toMatchObject({ status: "revoked", canUpload: false });
  expect(f.all).toHaveBeenCalledTimes(2);
});

it("does not release a D1 grant after its lookup cache lifetime elapsed in flight", async () => {
  let now = 2000;
  const old = deferred<{ results: EntitlementRow[] }>();
  const all = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ results: [{ ...active, status: "revoked" }] });
  const database = { prepare: () => ({ bind: () => ({ all }) }) } as unknown as NonNullable<Parameters<typeof createBridgeSubscriptions>[0]["AUTH_DB"]>;
  const reader = createBridgeSubscriptions({ AUTH_DB: database }, () => now);
  const pending = reader.status("account"); now += 60000;
  old.resolve({ results: [active] });
  expect((await pending).subscription).toMatchObject({ status: "revoked", canUpload: false });
  expect(all).toHaveBeenCalledTimes(2);
});

it("shares the replacement read across old and new callers after invalidation", async () => {
  const old = deferred<{ results: EntitlementRow[] }>(), fresh = deferred<{ results: EntitlementRow[] }>();
  const f = fixture(() => fresh.promise);
  f.all.mockReturnValueOnce(old.promise);
  const before = Array.from({ length: 20 }, () => f.reader.status("account"));
  f.reader.invalidate("account");
  const after = f.reader.status("account");
  old.resolve({ results: [active] }); fresh.resolve({ results: [{ ...active, status: "revoked" }] });
  expect((await Promise.all([...before, after])).every((s) => !s.subscription.canUpload)).toBe(true);
  expect(f.all).toHaveBeenCalledTimes(2);
});

it("keeps an obsolete failure from deleting a replacement read and retries current D1 failures", async () => {
  let reject!: (error: Error) => void;
  const old = new Promise<{ results: EntitlementRow[] }>((_resolve, fail) => { reject = fail; });
  const f = fixture(async () => ({ results: [active] })); f.all.mockReturnValueOnce(old);
  const before = f.reader.status("account").catch((error) => error);
  f.reader.invalidate("account"); await f.reader.status("account");
  reject(new Error("Obsolete D1 failure")); await before;
  expect((await f.reader.status("account")).subscription.canUpload).toBe(true);
  expect(f.all).toHaveBeenCalledTimes(2);
  f.reader.invalidate("account"); f.all.mockRejectedValueOnce(new Error("D1 unavailable"));
  await expect(f.reader.status("account")).rejects.toThrow("D1 unavailable");
  expect((await f.reader.status("account")).subscription.canUpload).toBe(true);
});

it("keeps account cache entries separate and caches missing grants", async () => {
  const f = fixture(async (account) => ({ results: account === "owner" ? [active] : [] }));
  expect((await f.reader.status("owner")).subscription.canUpload).toBe(true);
  expect((await f.reader.status("other")).subscription).toMatchObject({ status: "none", canUpload: false });
  f.reader.invalidate("owner");
  await f.reader.status("other"); expect(f.all).toHaveBeenCalledTimes(2);
  await f.reader.status("owner"); expect(f.all).toHaveBeenCalledTimes(3);
});

it("re-evaluates exact start and end boundaries without refreshing the D1 rows", async () => {
  let now = 999;
  const f = fixture(async () => ({ results: [{ ...active, expires_at: 3000 }] }), () => now);
  expect((await f.reader.status("account")).subscription).toMatchObject({ status: "scheduled", canUpload: false });
  now = 1000; expect((await f.reader.status("account")).subscription.canUpload).toBe(true);
  now = 2999; expect((await f.reader.status("account")).subscription.canUpload).toBe(true);
  now = 3000; expect((await f.reader.status("account")).subscription).toMatchObject({ status: "expired", canUpload: false });
  expect(f.all).toHaveBeenCalledOnce();
});

it.each([
  { plan_id: "unknown" }, { billing_interval: "weekly" }, { status: "invented" },
  { starts_at: -1 }, { starts_at: 2000, expires_at: 2000 }, { expires_at: 8640000000000001 },
] as const)("denies uploads for an invalid authoritative period: %j", async (patch) => {
  const f = fixture(async () => ({ results: [{ ...active, ...patch } as EntitlementRow] }));
  expect((await f.reader.status("account")).subscription).toMatchObject({ status: "unavailable", canUpload: false });
});

it.each([
  ["active", "active", undefined], ["revoked", "active", "beta"],
  ["active", "revoked", undefined], ["revoked", "revoked", "beta"],
] as const)("selects paid=%s and beta=%s independently", async (paidStatus, betaStatus, source) => {
  const f = fixture(async () => ({ results: [{ ...active, status: paidStatus }, { ...active, source: "beta", billing_interval: null, status: betaStatus }] }));
  const result = (await f.reader.status("account")).subscription;
  expect(result.source).toBe(source);
  expect(result.canUpload).toBe(paidStatus === "active" || betaStatus === "active");
});

it("hands an active beta period to a scheduled paid period at its exact start", async () => {
  let now = 1500;
  const f = fixture(async () => ({ results: [{ ...active, starts_at: 3000 }, { ...active, source: "beta", billing_interval: null, expires_at: 3000 }] }), () => now);
  expect((await f.reader.status("account")).subscription).toMatchObject({ source: "beta", status: "active" });
  now = 3000;
  const current = (await f.reader.status("account")).subscription;
  expect(current).toMatchObject({ status: "active", canUpload: true }); expect(current.source).toBeUndefined();
  expect(f.all).toHaveBeenCalledOnce();
});

it.each([
  [undefined, true], ["local", true], ["staging", false], ["production", false],
] as const)("keeps development access explicitly local: %s", async (environment, allowed) => {
  const reader = createBridgeSubscriptions({ BRIDGE_DEV_AUTH: "true", BRIDGE_ENV: environment });
  expect((await reader.status("account")).subscription.canUpload).toBe(allowed);
});

it("keeps distinct pending accounts single-flight when the bounded cache evicts their entries", async () => {
  const accounts = 300;
  const f = fixture(async () => {
    if (f.all.mock.calls.length > accounts) throw new Error("A pending lookup was replayed after cache eviction");
    return { results: [active] };
  });
  const values = await Promise.all(Array.from({ length: accounts }, (_, n) => f.reader.status(`account-${n}`)));
  expect(values.every((value) => value.subscription.canUpload)).toBe(true);
  expect(f.all).toHaveBeenCalledTimes(accounts);
});

it("still fences invalidation of a pending account after its cache entry was evicted", async () => {
  const old = deferred<{ results: EntitlementRow[] }>(); let first = true;
  const f = fixture(async (account) => {
    if (account === "account-0" && first) { first = false; return old.promise; }
    return { results: [{ ...active, status: account === "account-0" ? "revoked" : "active" }] };
  });
  const pending = Array.from({ length: 300 }, (_, n) => f.reader.status(`account-${n}`));
  f.reader.invalidate("account-0");
  const current = f.reader.status("account-0"); old.resolve({ results: [active] });
  const values = await Promise.all(pending);
  expect(values[0].subscription.canUpload).toBe(false);
  expect((await current).subscription).toMatchObject({ status: "revoked", canUpload: false });
  expect(f.all).toHaveBeenCalledTimes(301);
});
