import assert from "node:assert/strict";
import test from "node:test";
import { WsTransport } from "../src/backend/ws-transport.ts";

test("oversized responses are rejected without losing another command's acknowledgement", async () => {
  const socket = { readyState: 1, send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
  const transport = new WsTransport("ws://test", { factory: () => socket, invokeTimeoutMs: 0, maxMessageChars: 256 });
  transport.connect();
  socket.onopen();
  const read = transport.invoke("runs:getHistory");
  const command = transport.invoke("runs:updateConversationSettings");
  socket.onmessage({ data: JSON.stringify({ kind: "response", id: 1, result: { success: true, data: "x".repeat(1024) } }) });
  socket.onmessage({ data: JSON.stringify({ kind: "response", id: 2, result: { success: true, data: "saved" } }) });
  await assert.rejects(read, /mobile data limit/);
  assert.deepEqual(await command, { success: true, data: "saved" });
  assert.equal(transport.status(), "connected");
  transport.dispose();
});

test("oversized events never reach render listeners; small events still arrive", () => {
  const socket = { readyState: 1, send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
  const transport = new WsTransport("ws://test", { factory: () => socket, maxMessageChars: 256 });
  transport.connect(); socket.onopen();
  const events = [];
  transport.subscribe("runs:ephemeralEvent", (payload) => events.push(payload));
  socket.onmessage({ data: JSON.stringify({ kind: "event", channel: "runs:ephemeralEvent", payload: "x".repeat(1024) }) });
  socket.onmessage({ data: JSON.stringify({ kind: "event", channel: "runs:ephemeralEvent", payload: "small" }) });
  assert.deepEqual(events, ["small"]);
  transport.dispose();
});

test("a synchronous send failure retires the socket and rejects every waiting request", async () => {
  const socket = { readyState: 1, send() { throw new Error("Native socket unavailable"); }, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
  const transport = new WsTransport("ws://test", { factory: () => socket, invokeTimeoutMs: 0, reconnect: false });
  transport.connect(); socket.onopen();
  await assert.rejects(transport.invoke("runs:continue", [], { commandId: "one-attempt" }), /connection closed/);
  assert.equal(transport.status(), "offline");
  transport.dispose();
});

test("a fatal refusal rejects new invokes immediately and cannot be reopened", async () => {
  const socket = { readyState: 0, send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
  let opens = 0;
  const transport = new WsTransport("ws://test", { factory: () => { opens++; return socket; }, invokeTimeoutMs: 0, isFatalClose: () => true });
  transport.connect(); socket.onclose({ code: 1008, reason: "401 unauthorized" });
  let rejection;
  const pending = transport.invoke("runs:continue").catch((error) => { rejection = error; });
  try {
    await Promise.resolve();
    assert.match(rejection?.message ?? "", /refused|unauthorized/i);
    transport.connect();
    assert.equal(opens, 1);
    assert.equal(transport.status(), "offline");
  } finally { transport.dispose(); await pending; }
});

test("a failed queued send stops the drain and rejects the remaining commands", async () => {
  let sends = 0;
  const socket = { readyState: 0, send() { sends++; throw new Error("Native socket unavailable"); }, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
  const transport = new WsTransport("ws://test", { factory: () => socket, invokeTimeoutMs: 0, reconnect: false });
  transport.connect();
  const first = assert.rejects(transport.invoke("runs:continue"), /connection closed/);
  const second = assert.rejects(transport.invoke("runs:continue"), /connection closed/);
  socket.readyState = 1;
  assert.doesNotThrow(() => socket.onopen());
  await Promise.all([first, second]);
  assert.equal(sends, 1);
  assert.equal(transport.status(), "offline");
  transport.dispose();
});

test("dispose drops queued commands and late callbacks cannot send or deliver them", async () => {
  const sent = [], events = [];
  const socket = { readyState: 0, send(data) { sent.push(data); }, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
  const transport = new WsTransport("ws://test", { factory: () => socket, invokeTimeoutMs: 0 });
  transport.connect();
  transport.subscribe("runs:statusChanged", (event) => events.push(event));
  const pending = assert.rejects(transport.invoke("runs:continue"), /disposed/);
  transport.dispose(); transport.dispose();
  socket.readyState = 1; socket.onopen(); socket.onclose();
  socket.onmessage({ data: JSON.stringify({ kind: "event", channel: "runs:statusChanged", payload: "stale" }) });
  await pending;
  assert.deepEqual(sent, []); assert.deepEqual(events, []);
  assert.equal(transport.status(), "offline");
});
