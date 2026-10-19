import { signFixture } from "./record-signing.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { BridgeClientMessage, BridgeEnvelope, BridgeRpcResponse, BridgeServerMessage } from "@mains/contracts/bridge-protocol";
import { reportWriteBudget, subscriptionWriteBudgetPeriod, writeBudgetPeriod, type WriteBudgetEvent } from "../src/write-budget";
import { bridgePeriodEnd } from "../src/subscription-admin";
import { startLocalBridgeHub } from "./local-hub.mjs";

const at = (iso: string) => Date.parse(iso);
const hubId = "a".repeat(64);

describe("fair-use write budget periods", () => {
  it("anchors monthly windows to the entitlement start, clamping short months without drifting", () => {
    const anchor = at("2026-01-31T10:00:00Z");
    expect(writeBudgetPeriod(anchor, at("2026-02-28T09:59:59Z"))).toEqual({ start: anchor, end: at("2026-02-28T10:00:00Z") });
    expect(writeBudgetPeriod(anchor, at("2026-02-28T10:00:00Z"))).toEqual({ start: at("2026-02-28T10:00:00Z"), end: at("2026-03-31T10:00:00Z") });
    expect(writeBudgetPeriod(anchor, at("2026-03-31T10:00:00Z"))).toEqual({ start: at("2026-03-31T10:00:00Z"), end: at("2026-04-30T10:00:00Z") });
    expect(writeBudgetPeriod(anchor, at("2027-01-15T00:00:00Z"))).toEqual({ start: at("2026-12-31T10:00:00Z"), end: at("2027-01-31T10:00:00Z") });
    // Grant arithmetic shares the same month helper and keeps its semantics.
    expect(bridgePeriodEnd(anchor, "monthly")).toBe(at("2026-02-28T10:00:00Z"));
    expect(bridgePeriodEnd(at("2028-02-29T00:00:00Z"), "yearly")).toBe(at("2029-02-28T00:00:00Z"));
  });

  it("falls back to the UTC calendar month without a started entitlement", () => {
    const now = at("2026-10-17T09:00:00Z"), month = { start: at("2026-10-01T00:00:00Z"), end: at("2026-11-01T00:00:00Z") };
    expect(writeBudgetPeriod(null, now)).toEqual(month);
    expect(writeBudgetPeriod(at("2026-12-01T00:00:00Z"), now)).toEqual(month);
    expect(subscriptionWriteBudgetPeriod(undefined, now)).toEqual(month);
    expect(subscriptionWriteBudgetPeriod({ status: "development", planId: "standard", billingInterval: null, startsAt: null, expiresAt: null, canUpload: true }, now)).toEqual(month);
    expect(subscriptionWriteBudgetPeriod({ status: "active", planId: "standard", billingInterval: "yearly", startsAt: "2026-03-20T12:00:00.000Z",
      expiresAt: "2027-03-20T12:00:00.000Z", canUpload: true }, now)).toEqual({ start: at("2026-09-20T12:00:00Z"), end: at("2026-10-20T12:00:00Z") });
  });
});

describe("fair-use write budget reporting", () => {
  const period = { start: at("2026-10-01T00:00:00Z"), end: at("2026-11-01T00:00:00Z") };
  const report = (before: number, after: number, env: Record<string, string> = { BRIDGE_RECORDS_PER_MONTH: "1000", BRIDGE_ENV: "staging" }) => {
    const events: WriteBudgetEvent[] = [];
    reportWriteBudget(env as never, hubId, period, before, after, (event) => events.push(event));
    return events;
  };

  it("emits each threshold once, only on the publication that crosses it", () => {
    expect(report(0, 799)).toEqual([]);
    expect(report(799, 800)).toEqual([{ event: "bridge.write_budget", hubId, environment: "staging", threshold: 80, records: 800, budget: 1000,
      periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z" }]);
    expect(report(800, 999)).toEqual([]);
    expect(report(999, 1000).map((event) => event.threshold)).toEqual([100]);
    expect(report(1000, 5000)).toEqual([]);
    expect(report(700, 1100).map((event) => event.threshold)).toEqual([80, 100]);
  });

  it("uses the default budget, hides unexpected ids and never throws on bad configuration", () => {
    const events: WriteBudgetEvent[] = [];
    reportWriteBudget({} as never, "not-a-hub-id", period, 199_999, 200_000, (event) => events.push(event));
    expect(events).toMatchObject([{ threshold: 80, budget: 250_000, hubId: "unavailable", environment: "local" }]);
    expect(report(0, 10_000, { BRIDGE_RECORDS_PER_MONTH: "not-a-number" })).toEqual([]);
    expect(() => reportWriteBudget({} as never, hubId, period, 0, 250_000, () => { throw new Error("sink failed"); })).not.toThrow();
  });
});

describe("fair-use write budget accounting in the account hub", () => {
  let hub: Awaited<ReturnType<typeof startLocalBridgeHub>>;
  const sockets: WebSocket[] = [];
  beforeAll(async () => { hub = await startLocalBridgeHub(); });
  afterAll(async () => { for (const socket of sockets) socket.terminate(); await hub?.dispose(); });
  const opaque = (id: string) => createHash("sha256").update(id).digest().subarray(0, 16).toString("base64url");
  const record = (id: string, clock: number, op: "upsert" | "delete" = "upsert"): BridgeEnvelope => {
    const base = { v: 1 as const, stream: "account" as const, rowKey: opaque(id), hlc: { physicalMs: clock, counter: 0 }, origin: "A" };
    return { header: op === "delete" ? { ...base, op } : { ...base, op, registerKey: opaque(`${id}:row`) },
      body: { nonce: randomBytes(24).toString("base64url"), payload: randomBytes(64).toString("base64url") } };
  };
  async function connect(account: string, backend = "A") {
    const socket = new WebSocket(hub.wsUrl, { headers: { Authorization: `Bearer ${await hub.token(account, backend)}` } });
    sockets.push(socket);
    const pending = new Map<string, (message: BridgeServerMessage) => void>();
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as BridgeRpcResponse;
      if ("requestId" in frame && "message" in frame) { pending.get(frame.requestId)?.(frame.message); pending.delete(frame.requestId); }
    });
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    return (message: BridgeClientMessage) => new Promise<BridgeServerMessage>((resolve) => {
      if (message.type === "push") for (const record of message.records) { record.header.origin = backend; signFixture(record, account, backend); }
      const requestId = randomUUID(); pending.set(requestId, resolve); socket.send(JSON.stringify({ requestId, message }));
    });
  }
  const counted = (account: string) => hub.quotaSql(account, "SELECT period_start,records FROM write_budget");

  it("counts newly accepted upserts once per publication, never refusals, re-ACKs or deletes", async () => {
    const account = randomUUID(), a = await connect(account), b = await connect(account, "B");
    const now = new Date(), month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    expect(await a({ type: "push", stream: "account", records: [record("one", 1), record("two", 1), record("three", 1)] })).toMatchObject({ type: "ack" });
    expect(await counted(account)).toEqual([{ period_start: month, records: 3 }]);
    // Idempotent retry: same clocks are acknowledged without new accepted records.
    await a({ type: "push", stream: "account", records: [record("one", 1), record("two", 1)] });
    // A refused writer (origin mismatch) and a permanent delete are free.
    expect(await b({ type: "push", stream: "account", records: [{ ...record("four", 1), header: { ...record("four", 1).header, owner: "A" } }] })).toMatchObject({ results: [{ error: "notOwner" }] });
    await a({ type: "push", stream: "account", records: [record("three", 2, "delete")] });
    expect(await counted(account)).toEqual([{ period_start: month, records: 3 }]);
    // A newer register version is a new accepted record.
    await a({ type: "push", stream: "account", records: [record("one", 2)] });
    expect(await counted(account)).toEqual([{ period_start: month, records: 4 }]);
  });
});
