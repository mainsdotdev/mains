import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import * as streams from "../src/backend/streaming-messages.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let frames, next, renderer, latest;
beforeEach(() => {
  frames = new Map(); next = 0; latest = [];
  globalThis.requestAnimationFrame = (callback) => { frames.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
});
afterEach(async () => { if (renderer) await act(() => renderer.unmount()); renderer = undefined; streams.clearAllStreamingMessages(); });
async function mount() {
  function Probe() { latest = streams.useStreamingMessages("run"); return null; }
  await act(() => { renderer = create(React.createElement(Probe)); });
}
async function frame() { await act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); }); }
function receive(content, streamId = "message") {
  streams.receiveStreamingMessage({ runId: "run", ts: 1000, event: { type: "artifact", kind: "report", streamId, content,
    metadata: { source: "agent_message_streaming" } } });
}

test("a durable stream identity retires a phone preview and late snapshots cannot revive it", async () => {
  await mount(); receive("Final answer"); await frame();
  assert.equal(latest.length, 1);
  await act(() => streams.reconcileStreamingMessages("run", new Set(["message"])));
  await frame(); assert.equal(latest.length, 0);
  receive("Late partial"); await frame(); assert.equal(latest.length, 0);
});
test("terminal status retains the phone's answer until history acknowledges it", async () => {
  await mount(); receive("Interrupted answer"); await frame();
  await act(() => streams.settleStreamingMessages("run", true));
  assert.equal(latest[0].text, "Interrupted answer");
  receive("Late replacement"); receive(""); await frame();
  assert.equal(latest[0].text, "Interrupted answer");
  receive("Next reply", "next-message"); await frame();
  assert.deepEqual(latest.map((message) => message.text), ["Interrupted answer", "Next reply"]);
  await act(() => streams.reconcileStreamingMessages("run", new Set(["message"])));
  await frame(); assert.deepEqual(latest.map((message) => message.text), ["Next reply"]);
});
