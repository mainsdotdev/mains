import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pairWithBackend } from "../src/backend/pair-device.ts";

const originalFetch = globalThis.fetch;
const link = { code: "pair-code", name: "Computer", endpoints: ["http://first:8787", "https://second.example"] };
const device = { deviceName: "Phone", platform: "ios" };
const reply = { deviceId: "device", deviceToken: "secret", backend: { backendId: "backend", name: "Computer", appVersion: "1", protocolVersion: 1, capabilities: [], serverTime: new Date().toISOString() } };
afterEach(() => { globalThis.fetch = originalFetch; });

test("pairing cancellation fences a late success without trying another endpoint", async () => {
  const controller = new AbortController();
  let finish;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Promise((resolve) => { finish = resolve; });
  };
  const pairing = pairWithBackend(link, device, { signal: controller.signal });
  controller.abort();
  finish(new Response(JSON.stringify(reply)));
  await assert.rejects(pairing, /cancel/i);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.signal.aborted, true);
});

test("connection failure tries the next address and remembers the reachable one first", async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (urls.length === 1) throw new Error("Unreachable");
    return new Response(JSON.stringify(reply));
  };
  const paired = await pairWithBackend(link, device);
  assert.deepEqual(urls, link.endpoints.map((url) => `${url}/pair`));
  assert.deepEqual(paired.endpoints, [...link.endpoints].reverse());
  assert.equal(paired.deviceToken, reply.deviceToken);
});

test("an authoritative refusal never replays a code against another address", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: "Code spent" }), { status: 401 }); };
  await assert.rejects(pairWithBackend(link, device), /Code spent/);
  assert.equal(calls, 1);
});

test("an already canceled pairing never contacts the backend", async () => {
  globalThis.fetch = async () => assert.fail("no request after cancellation");
  await assert.rejects(pairWithBackend(link, device, { signal: AbortSignal.abort() }), /cancel/i);
});

test("malformed successful replies cannot install empty device credentials", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ...reply, deviceToken: "" })); };
  await assert.rejects(pairWithBackend(link, device), /Unexpected reply/);
  assert.equal(calls, 1);
});
