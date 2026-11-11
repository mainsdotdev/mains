import assert from "node:assert/strict";
import test from "node:test";
import { createHistoryRequests } from "@mains/contracts/transcript-history";

test("live refresh bursts coalesce without overtaking an admitted page navigation", async () => {
  const requests = createHistoryRequests(), owner = {}, calls = [];
  let finish;
  const active = requests.run("b/r", owner, "refresh", async () => {
    calls.push("first"); await new Promise((resolve) => { finish = resolve; });
  });
  await new Promise((resolve) => setImmediate(resolve));
  const older = requests.run("b/r", owner, "older", async () => { calls.push("older"); });
  const trailing = requests.run("b/r", owner, "refresh", async () => { calls.push("refresh"); });
  const duplicate = requests.run("b/r", owner, "refresh", async () => assert.fail("coalesced"));
  assert.equal(trailing, duplicate);
  finish(); await Promise.all([active, older, trailing]);
  assert.deepEqual(calls, ["first", "older", "refresh"]);
});

test("a failed request cannot discard an admitted refresh or later navigation", async () => {
  const requests = createHistoryRequests(), owner = {}, calls = [];
  const failing = requests.run("b/r", owner, "refresh", async () => { calls.push("failed"); throw new Error("offline"); });
  const refresh = requests.run("b/r", owner, "refresh", async () => { calls.push("retry"); });
  // A burst before dispatch joins the still-waiting first refresh.
  assert.equal(refresh, failing);
  const navigation = requests.run("b/r", owner, "older", async () => { calls.push("older"); });
  const trailing = requests.run("b/r", owner, "refresh", async () => { calls.push("refresh"); });
  await assert.rejects(failing, /offline/);
  await Promise.all([navigation, trailing]);
  assert.deepEqual(calls, ["failed", "older", "refresh"]);
});

test("retirement releases waiting navigation immediately and admits a fresh owner", async () => {
  const requests = createHistoryRequests(), owner = {};
  let finish, entered, signal;
  const started = new Promise((resolve) => { entered = resolve; });
  const first = requests.run("b/r", owner, "refresh", async (current) => {
    signal = current; entered(); await new Promise((resolve) => { finish = resolve; });
  });
  await started;
  const waiting = requests.run("b/r", owner, "older", async () => assert.fail("retired navigation"));
  requests.retire("b/r");
  await Promise.all([first, waiting]);
  assert.equal(signal.aborted, true);
  let published = false;
  await requests.run("b/r", {}, "latest", async () => { published = true; });
  assert.equal(published, true);
  finish();
});
