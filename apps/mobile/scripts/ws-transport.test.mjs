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
