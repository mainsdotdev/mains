import assert from "node:assert/strict";
import test from "node:test";
import { deliverCommand } from "../src/backend/command-delivery.ts";

test("reconnect retries the same command identity but a backend refusal is final", async () => {
  const attempts = [];
  const response = { success: false, error: "Command outcome is unknown; check the conversation" };
  const target = {
    isCurrent: () => true,
    waitForConnected: async () => ({ invoke: async (_channel, _args, options) => {
      attempts.push(options.commandId);
      if (attempts.length === 1) throw new Error("WebSocket connection closed");
      return response;
    } }),
  };
  assert.equal(await deliverCommand(target, "runs:continue", [], "same-command"), response);
  assert.deepEqual(attempts, ["same-command", "same-command"]);
});

test("a connection recovered after the deadline cannot send the expired command", async (t) => {
  let now = 0, calls = 0;
  t.mock.method(Date, "now", () => now);
  const target = {
    isCurrent: () => true,
    waitForConnected: async () => { now = 1001; return { invoke: async () => { calls++; return { success: true }; } }; },
  };
  await assert.rejects(deliverCommand(target, "runs:continue", [], "expired", 1000), /timed out/i);
  assert.equal(calls, 0);
});

test("the response wait uses only the time remaining after reconnect", async (t) => {
  let now = 0, responseTimeout;
  t.mock.method(Date, "now", () => now);
  const target = {
    isCurrent: () => true,
    waitForConnected: async () => { now = 800; return { invoke: async (_channel, _args, options) => {
      responseTimeout = options.timeoutMs; return { success: true, data: "saved" };
    } }; },
  };
  await deliverCommand(target, "runs:continue", [], "bounded", 1000);
  assert.equal(responseTimeout, 200);
});

test("a late reply from a replaced backend cannot complete the current command", async () => {
  let current = true;
  const target = {
    isCurrent: () => current,
    waitForConnected: async () => ({ invoke: async () => { current = false; return { success: true, data: "old backend" }; } }),
  };
  await assert.rejects(deliverCommand(target, "runs:continue", [], "old-command"), /computer changed/);
});
