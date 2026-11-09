import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { sqlite } from "./fixtures/sync-native.mjs";
const { syncRun, attachRunEvents, clearBackend } = await import("../src/backend/sync.ts");
const { historyState, setHistoryFollowing } = await import("../src/backend/run-history.ts");
const { CHANNELS } = await import("@mains/contracts/channels");

const cursor = (id) => ({ timestamp: id * 1000, source: "artifact", id });
const page = (id) => ({ artifacts: [{ id, runId: "r", kind: "report", content: `message-${id}`, createdAt: new Date(id * 1000).toISOString() }],
  toolCalls: [], turns: [], start: cursor(id), last: cursor(id), end: null, hasOlder: true, hasNewer: false });
const ok = (data) => ({ success: true, data });
function transport(read) {
  return {
    subscribe: () => () => {},
    invoke: async (channel, args) => {
      if (channel === CHANNELS.runs.getById) return ok({ id: args[0], title: "Chat", status: "succeeded", mode: "work", providerId: "codex" });
      if (channel === CHANNELS.runs.getHistory) return ok(await read(args[0]));
      if (channel === CHANNELS.runs.listPendingApprovals) return ok([]);
      throw new Error(`Unexpected channel ${channel}`);
    },
  };
}
beforeEach(() => { clearBackend("b"); clearBackend("other"); });
after(() => { clearBackend("b"); sqlite.close(); });

test("a confirmed mobile history replaces its disposable SQLite projection", async () => {
  let selected = 90;
  const socket = transport(async () => page(selected));
  await syncRun(socket, "b", "r"); selected = 70;
  await syncRun(socket, "b", "r", "older");
  assert.deepEqual(sqlite.prepare("SELECT content FROM run_artifacts WHERE backend_id='b' AND run_id='r'").all().map((row) => row.content), ["message-70"]);
  assert.equal(historyState("b", "r").loading, false);
});

test("detaching the old transport retires its pending transcript write", async () => {
  let finish, entered;
  const reading = new Promise((resolve) => { entered = resolve; });
  const socket = transport(async () => { entered(); return new Promise((resolve) => { finish = resolve; }); });
  const detach = attachRunEvents(socket, "b", { isViewing: () => true });
  const syncing = syncRun(socket, "b", "r");
  await reading; detach(); finish(page(90)); await syncing;
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM run_artifacts").get().n, 0);
  assert.equal(historyState("b", "r").loaded, false);
  assert.equal(historyState("b", "r").loading, false);
});

test("a replacement transport publishes without waiting for an abandoned native request", async () => {
  let finish, entered;
  const reading = new Promise((resolve) => { entered = resolve; });
  const old = transport(async () => { entered(); return new Promise((resolve) => { finish = resolve; }); });
  const pending = syncRun(old, "b", "r");
  await reading;
  await syncRun(transport(async () => page(70)), "b", "r");
  finish(page(90)); await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sqlite.prepare("SELECT content FROM run_artifacts WHERE backend_id='b'").get().content, "message-70");
  assert.deepEqual(historyState("b", "r").start, cursor(70));
});

test("forgetting a backend before dispatch retires queued reads too", async () => {
  const socket = transport(async () => assert.fail("retired before dispatch"));
  const pending = syncRun(socket, "b", "r");
  clearBackend("b"); await pending;
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM runs").get().n, 0);
  assert.equal(historyState("b", "r").loaded, false);
});

test("navigation keeps its order ahead of a coalesced refresh and commits the selected bounds", async () => {
  let finish, entered;
  const reading = new Promise((resolve) => { entered = resolve; });
  const calls = [];
  const socket = transport(async (request) => {
    calls.push(request);
    if (calls.length === 1) { entered(); return new Promise((resolve) => { finish = resolve; }); }
    return { ...page(70), end: cursor(90), hasNewer: true };
  });
  const initial = syncRun(socket, "b", "r");
  await reading;
  const older = syncRun(socket, "b", "r", "older");
  const refresh = syncRun(socket, "b", "r");
  assert.equal(syncRun(socket, "b", "r"), refresh);
  finish(page(90)); await Promise.all([initial, older, refresh]);
  assert.deepEqual(calls.map((call) => call.direction), ["latest", "older", "refresh"]);
  assert.deepEqual(calls[1].cursor, cursor(90));
  assert.deepEqual(calls[2].cursor, cursor(70));
  assert.deepEqual(calls[2].end, cursor(90));
  assert.equal(sqlite.prepare("SELECT content FROM run_artifacts WHERE backend_id='b'").get().content, "message-70");
});

test("a failed projection rolls back all rows and retries the failed direction", async () => {
  let selected = 90;
  const calls = [];
  const socket = transport(async (request) => { calls.push(request); return page(selected); });
  await syncRun(socket, "b", "r"); selected = 70;
  sqlite.exec("CREATE TRIGGER reject_history BEFORE INSERT ON run_artifacts BEGIN SELECT RAISE(ABORT,'disk full'); END");
  try { await assert.rejects(syncRun(socket, "b", "r", "older")); }
  finally { sqlite.exec("DROP TRIGGER reject_history"); }
  assert.equal(sqlite.prepare("SELECT content FROM run_artifacts WHERE backend_id='b'").get().content, "message-90");
  assert.deepEqual(historyState("b", "r").start, cursor(90));
  assert.equal(historyState("b", "r").retryDirection, "older");
  await syncRun(socket, "b", "r", historyState("b", "r").retryDirection);
  assert.equal(calls.at(-1).direction, "older");
  assert.deepEqual(calls.at(-1).cursor, cursor(90));
  assert.equal(historyState("b", "r").error, null);
});

test("a reading pause before history dispatch freezes the last confirmed boundary", async () => {
  const calls = [];
  const socket = transport(async (request) => { calls.push(request); return page(90); });
  await syncRun(socket, "b", "r");
  let finish, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const invoke = socket.invoke;
  socket.invoke = async (channel, args) => {
    if (channel === CHANNELS.runs.getById) { entered(); await new Promise((resolve) => { finish = resolve; }); }
    return invoke(channel, args);
  };
  const refreshing = syncRun(socket, "b", "r");
  await waiting; setHistoryFollowing("b", "r", false); finish(); await refreshing;
  assert.deepEqual(calls.at(-1).end, { ...cursor(90), id: 91 });
  assert.equal(historyState("b", "r").historical, false);
});
