import { signFixture, fixturePublicKey } from "./record-signing.mjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { afterEach, expect, it } from "vitest";
import type { BridgeClientMessage, BridgeEnvelope, BridgeRpcResponse, BridgeServerMessage } from "@mains/contracts/bridge-protocol";
import type { BridgeSubscriptionStatus } from "@mains/contracts/bridge-subscription";
import type { BridgeBlobPresignResult } from "@mains/contracts/bridge-blobs";
import { startLocalBridgeHub } from "./local-hub.mjs";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const hub = await startLocalBridgeHub({ auth: true }); cleanup.push(() => hub.dispose());
  return hub;
}
type Hub = Awaited<ReturnType<typeof fixture>>;
async function backend(hub: Hub, email = `${randomUUID()}@example.test`, backendId = "A") {
  const browser = await hub.login(email), token = `b7_${randomBytes(32).toString("hex")}`;
  // Seed an approved credential; the full approval/recovery ceremonies have
  // their own real-workerd tests. All subscription checks use real auth/D1.
  await (await hub.database()).prepare(`INSERT INTO bridge_backends(account_id,backend_id,public_key,signing_public_key,label,platform,status,token_hash,token_expires_at,created_at)
    VALUES(?,?,?,?,?,?,'approved',?,?,?)`).bind(browser.user.id, backendId, randomBytes(32).toString("base64url"), fixturePublicKey(browser.user.id, backendId), backendId, "test",
    createHash("sha256").update(token).digest("hex"), Date.now() + 3_600_000, Date.now()).run();
  await hub.admit(browser.user.id, backendId);
  return { ...browser, token, accountId: browser.user.id as string, backendId };
}
type Backend = Awaited<ReturnType<typeof backend>>;
async function grant(hub: Hub, b: Backend, interval = "monthly", start = Date.now() - 1000, end = Date.now() + 86_400_000) {
  await http(hub, b, "/v1/subscription");
  await (await hub.database()).prepare(`INSERT INTO account_entitlements VALUES(?,'bridge','standard',?,'active',?,?,?)
    ON CONFLICT(account_id,feature) DO UPDATE SET billing_interval=excluded.billing_interval,status='active',starts_at=excluded.starts_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
    .bind(b.accountId, interval, start, end, Date.now()).run();
  await hub.evict(b.accountId);
}
async function http(hub: Hub, b: Backend, path: string, body?: unknown) {
  return fetch(new URL(path, hub.url), { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${b.token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function connect(hub: Hub, b: Backend) {
  const socket = new WebSocket(hub.wsUrl, { headers: { Authorization: `Bearer ${b.token}` } }); cleanup.push(() => socket.terminate());
  type Result = BridgeServerMessage | Extract<BridgeRpcResponse, { error: unknown }>;
  const pending = new Map<string, (value: Result) => void>();
  socket.on("message", (bytes) => {
    const frame = JSON.parse(bytes.toString()) as BridgeRpcResponse;
    if ("requestId" in frame) { pending.get(frame.requestId)?.("message" in frame ? frame.message : frame); pending.delete(frame.requestId); }
  });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return { socket, rpc(message: BridgeClientMessage): Promise<Result> {
    if (message.type === "push") for (const record of message.records) signFixture(record, b.accountId);
    return new Promise((resolve) => { const requestId = randomUUID(); pending.set(requestId, resolve); socket.send(JSON.stringify({ requestId, message })); });
  } };
}
function record(id: string = randomUUID(), op: "upsert" | "delete" = "upsert"): BridgeEnvelope {
  const opaque = (value: string) => createHash("sha256").update(value).digest().subarray(0, 16).toString("base64url");
  const h = { v: 1 as const, stream: "account" as const, rowKey: opaque(id), origin: "A", hlc: { physicalMs: Date.now(), counter: 0 } };
  return { header: op === "upsert" ? { ...h, op, registerKey: opaque(id + "register") } : { ...h, op }, body: { nonce: randomBytes(24).toString("base64url"), payload: randomBytes(64).toString("base64url") } };
}

it("requires a subscription for uploads, preserves read access and cannot be self-granted through HTTP", async () => {
  const hub = await fixture(), a = await backend(hub), socket = await connect(hub, a);
  const response = await http(hub, a, "/v1/subscription"); expect(response.status).toBe(200);
  const status = await response.json() as BridgeSubscriptionStatus;
  expect(status.subscription).toMatchObject({ status: "none", canUpload: false });
  expect(status.plans).toMatchObject([{ id: "standard", storageLimitBytes: 1024 ** 3, billingIntervals: ["monthly", "yearly"] }]);
  expect(await socket.rpc({ type: "push", stream: "account", records: [record()] })).toMatchObject({ results: [{ error: "subscriptionRequired" }] });
  expect(await socket.rpc({ type: "pull", stream: "account", after: 0, limit: 100 })).toMatchObject({ type: "records", records: [] });
  expect((await http(hub, a, "/v1/blobs/presign", { op: "put", blobs: [{ blobId: randomBytes(32).toString("base64url"), size: 3 }] })).status).toBe(403);
  expect((await http(hub, a, "/v1/subscription", { planId: "standard", billingInterval: "yearly", status: "active" })).status).toBe(405);
  expect(await (await hub.database()).prepare("SELECT count(*) n FROM account_entitlements").first()).toMatchObject({ n: 0 });
});

it.each(["monthly", "yearly"])("shares the %s account entitlement across approved devices and keeps accounts isolated", async (interval) => {
  const hub = await fixture(), email = `${randomUUID()}@example.test`, a = await backend(hub, email), b = await backend(hub, email, "B"), outsider = await backend(hub);
  await grant(hub, a, interval);
  const get = async (who: Backend) => (await (await http(hub, who, "/v1/subscription")).json()) as BridgeSubscriptionStatus;
  expect((await get(a)).subscription).toMatchObject({ status: "active", billingInterval: interval, canUpload: true });
  expect(await get(b)).toEqual(await get(a)); expect((await get(outsider)).subscription.canUpload).toBe(false);
  const x = await connect(hub, a), y = await connect(hub, b), row = record();
  expect(await x.rpc({ type: "push", stream: "account", records: [row] })).toMatchObject({ results: [{ seq: 1 }] });
  expect(await y.rpc({ type: "pull", stream: "account", after: 0, limit: 100 })).toMatchObject({ records: [{ seq: 1, envelope: row }] });
  const browser = await fetch(new URL(`/v1/subscription?accountId=${a.accountId}`, hub.url), { headers: { Cookie: outsider.cookie } });
  expect(browser.status).toBe(200); expect((await browser.json() as BridgeSubscriptionStatus).subscription.status).toBe("none");
});

it("enforces exact period expiry on an existing socket and old PUT capability while retaining downloads and tombstones", async () => {
  const hub = await fixture(), a = await backend(hub), x = await connect(hub, a);
  const end = Date.now() + 3000; await grant(hub, a, "monthly", Date.now() - 1000, end);
  const one = { blobId: randomBytes(32).toString("base64url"), size: 3 }, two = { ...one, blobId: randomBytes(32).toString("base64url") };
  const sign = async (op: string, blob = one) => {
    const response = await http(hub, a, "/v1/blobs/presign", { op, blobs: [blob] }); expect(response.status).toBe(200);
    return (await response.json() as BridgeBlobPresignResult).blobs[0].chunks[0].url;
  };
  const bytes = randomBytes(43), put = await sign("put"), pendingPut = await sign("put", two);
  expect((await fetch(put, { method: "PUT", body: bytes })).status).toBe(204);
  const get = await sign("get"), row = record("existing");
  expect(await x.rpc({ type: "push", stream: "account", records: [row] })).toMatchObject({ results: [{ seq: 1 }] });
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, end - Date.now() + 30)));
  expect(await x.rpc({ type: "push", stream: "account", records: [record()] })).toMatchObject({ results: [{ error: "subscriptionRequired" }] });
  expect((await fetch(pendingPut, { method: "PUT", body: bytes })).status).toBe(403);
  expect(Buffer.from(await (await fetch(get)).arrayBuffer())).toEqual(bytes);
  expect(await x.rpc({ type: "push", stream: "account", records: [record("existing", "delete")] })).toMatchObject({ results: [{ seq: 2 }] });
  const status = await (await http(hub, a, "/v1/subscription")).json() as BridgeSubscriptionStatus;
  expect(status.subscription).toMatchObject({ status: "expired", canUpload: false });
});

it("fails closed for scheduled, revoked and unknown plans; quota overrides do not grant membership", async () => {
  const hub = await fixture();
  for (const mode of ["scheduled", "revoked", "unknown", "none"]) {
    const a = await backend(hub), db = await hub.database();
    if (mode !== "none") await grant(hub, a, "yearly", Date.now() + (mode === "scheduled" ? 3_600_000 : -1000));
    if (mode === "revoked") await db.prepare("UPDATE account_entitlements SET status='revoked' WHERE account_id=?").bind(a.accountId).run();
    if (mode === "unknown") await db.prepare("UPDATE account_entitlements SET plan_id='future-tier' WHERE account_id=?").bind(a.accountId).run();
    await db.prepare("INSERT INTO bridge_account_quotas VALUES(?,'large',?,600)").bind(a.accountId, 10 * 1024 ** 3).run();
    const socket = await connect(hub, a);
    expect(await socket.rpc({ type: "push", stream: "account", records: [record()] })).toMatchObject({ results: [{ error: "subscriptionRequired" }] });
  }
});

it("fails closed when the entitlement schema is unavailable while reads and permanent deletion still work", async () => {
  const hub = await fixture(), a = await backend(hub), socket = await connect(hub, a);
  await (await hub.database()).exec("DROP TABLE account_entitlements");
  expect((await http(hub, a, "/v1/subscription")).status).toBe(503);
  expect(await socket.rpc({ type: "push", stream: "account", records: [record()] })).toMatchObject({ error: { code: "storageError" } });
  expect(await socket.rpc({ type: "pull", stream: "account", after: 0, limit: 100 })).toMatchObject({ records: [] });
  expect(await socket.rpc({ type: "push", stream: "account", records: [record("deleted", "delete")] })).toMatchObject({ results: [{ seq: 1 }] });
});
