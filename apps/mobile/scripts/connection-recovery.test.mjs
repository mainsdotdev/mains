import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionSupervisor, ProtocolMismatchError } from "../src/backend/connection-supervisor.ts";
import { WsTransport } from "../src/backend/ws-transport.ts";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
class Clock {
  now = 0;
  tasks = new Set();
  schedule = (fn, delay) => {
    const task = { at: this.now + delay, fn };
    this.tasks.add(task);
    return () => this.tasks.delete(task);
  };
  async tick(ms) {
    const end = this.now + ms;
    for (let count = 0; count < 2000; count++) {
      const task = [...this.tasks].filter((task) => task.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!task) { this.now = end; await flush(); return; }
      this.tasks.delete(task); this.now = task.at; task.fn(); await flush();
    }
    throw new Error("Timer loop did not settle");
  }
}
class Socket {
  readyState = 0;
  onopen = null; onclose = null; onerror = null; onmessage = null;
  closed = 0;
  send() {}
  open() { this.readyState = 1; this.onopen?.(); }
  drop(reason = "Network lost", code = 1006) { this.readyState = 3; this.onclose?.({ code, reason }); }
  close() { this.closed++; this.drop("Closed", 1000); }
}

async function harness({ endpoints = ["ws://mac-a", "ws://mac-b"], onConnected = async () => ({ backendId: "mac" }), factoryFailure = false } = {}) {
  const clock = new Clock(), sockets = [], states = [], networks = new Set(), lifecycles = new Set();
  const supervisor = new ConnectionSupervisor({ endpoints, onConnected, schedule: clock.schedule,
    createTransport(endpoint) {
      return new WsTransport(endpoint, { schedule: clock.schedule, invokeTimeoutMs: 0,
        isFatalClose: (info) => /\b401\b|unauthorized/i.test(info.reason ?? ""), factory: () => {
        if (factoryFailure) throw new Error("Socket creation failed");
        const socket = new Socket(); sockets.push({ endpoint, socket }); return socket;
      } });
    }, signals: {
      network: { isOnline: async () => true, subscribe: (fn) => { networks.add(fn); return () => networks.delete(fn); } },
      lifecycle: { isActive: () => true, subscribe: (fn) => { lifecycles.add(fn); return () => lifecycles.delete(fn); } },
    },
  });
  supervisor.subscribe(() => states.push({ at: clock.now, ...supervisor.getState() }));
  await supervisor.start();
  return { clock, supervisor, sockets, states, network: (online) => { for (const fn of networks) fn(online); },
    lifecycle: (active) => { for (const fn of lifecycles) fn(active); } };
}

test("a socket that never opens or closes is abandoned after ten seconds", async () => {
  const clock = new Clock(), socket = new Socket(), closed = [];
  const transport = new WsTransport("ws://mac", { factory: () => socket, schedule: clock.schedule });
  transport.onClose((info) => closed.push(info));
  transport.connect();
  await clock.tick(9999);
  assert.equal(socket.closed, 0);
  await clock.tick(1);
  assert.equal(socket.closed, 1);
  assert.equal(closed.length, 1);
  assert.match(closed[0].reason, /timed out/i);
  transport.dispose();
});

test("a previously connected computer becomes unreachable within thirty seconds of losing it", async () => {
  const h = await harness();
  try {
    h.sockets[0].socket.open(); await flush();
    assert.equal(h.supervisor.getState().kind, "connected");
    h.sockets[0].socket.drop();
    await h.clock.tick(30_000);
    assert.equal(h.supervisor.getState().kind, "unreachable");
  } finally { h.supervisor.dispose(); }
});

test("silent probes keep unreachable visible and try the next saved address", async () => {
  const h = await harness();
  try {
    await h.clock.tick(30_000);
    assert.equal(h.supervisor.getState().kind, "unreachable");
    const count = h.sockets.length, stateCount = h.states.length;
    await h.clock.tick(29_999);
    assert.equal(h.sockets.length, count);
    await h.clock.tick(1);
    assert.equal(h.sockets.at(-1).endpoint, "ws://mac-b");
    assert.equal(h.supervisor.getState().kind, "unreachable");
    assert.ok(h.states.slice(stateCount).every((state) => state.kind === "unreachable"));
    h.sockets.at(-1).socket.open(); await flush();
    assert.equal(h.supervisor.getState().kind, "connected");
  } finally { h.supervisor.dispose(); }
});

test("a once-working address rotates after three failed opens rather than keeping its old endpoint forever", async () => {
  const h = await harness();
  try {
    h.sockets[0].socket.open(); await flush();
    h.sockets[0].socket.drop();
    await h.clock.tick(500);
    h.sockets.at(-1).socket.drop();
    await h.clock.tick(1000);
    h.sockets.at(-1).socket.drop();
    assert.equal(h.sockets.at(-1).endpoint, "ws://mac-b");
    h.sockets.at(-1).socket.open(); await flush();
    await h.clock.tick(60_000);
    assert.equal(h.supervisor.getState().kind, "connected");
    assert.equal(h.clock.tasks.size, 0);
  } finally { h.supervisor.dispose(); }
});

test("late open, close and response callbacks cannot resurrect an expired socket or affect its replacement", async () => {
  const clock = new Clock(), sockets = [];
  const transport = new WsTransport("ws://mac", { schedule: clock.schedule, invokeTimeoutMs: 0, factory: () => {
    const socket = new Socket(); sockets.push(socket); return socket;
  } });
  transport.connect();
  const old = { open: sockets[0].onopen, close: sockets[0].onclose, message: sockets[0].onmessage };
  await clock.tick(10_500);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  const response = transport.invoke("example:read");
  let resolved = false;
  void response.then(() => { resolved = true; });
  old.open(); old.close({ code: 1006 });
  old.message({ data: JSON.stringify({ kind: "response", id: 1, result: { success: true, data: "stale" } }) });
  await flush();
  assert.equal(resolved, false);
  assert.equal(transport.status(), "connected");
  sockets[1].onmessage({ data: JSON.stringify({ kind: "response", id: 1, result: { success: true, data: "current" } }) });
  assert.deepEqual(await response, { success: true, data: "current" });
  transport.dispose();
  assert.equal(clock.tasks.size, 0);
});

test("a healthy socket cancels its open deadline even when a custom scheduler cannot cancel timers", async () => {
  const clock = new Clock(), socket = new Socket();
  const transport = new WsTransport("ws://mac", { factory: () => socket, schedule: (fn, ms) => { clock.schedule(fn, ms); } });
  transport.connect(); socket.open();
  await clock.tick(20_000);
  assert.equal(transport.status(), "connected");
  assert.equal(socket.closed, 0);
  transport.dispose();
});

test("an unresponsive initial sync is bounded too and its late completion cannot report Live", async () => {
  let complete;
  const h = await harness({ onConnected: () => new Promise((resolve) => { complete = resolve; }) });
  try {
    h.sockets[0].socket.open();
    assert.equal(h.supervisor.getState().kind, "syncing");
    await h.clock.tick(30_000);
    assert.equal(h.supervisor.getState().kind, "unreachable");
    complete({ backendId: "late" }); await flush();
    assert.equal(h.supervisor.getState().kind, "unreachable");
  } finally { h.supervisor.dispose(); }
});

test("a socket lost during sync cannot overwrite a replacement's connection status", async () => {
  let failOld, calls = 0;
  const h = await harness({ onConnected: () => ++calls === 1
    ? new Promise((_, reject) => { failOld = reject; }) : Promise.resolve({ backendId: "current" }) });
  try {
    h.sockets[0].socket.open(); h.sockets[0].socket.drop();
    await h.clock.tick(500);
    h.sockets.at(-1).socket.open(); await flush();
    assert.equal(h.supervisor.getState().kind, "connected");
    failOld(new Error("Old sync failed")); await flush();
    assert.equal(h.supervisor.getState().kind, "connected");
    assert.equal(h.clock.tasks.size, 0);
  } finally { h.supervisor.dispose(); }
});

test("manual retry skips the slow wait and clears previous deadlines", async () => {
  const h = await harness();
  try {
    await h.clock.tick(30_000);
    const count = h.sockets.length;
    h.supervisor.retry();
    assert.equal(h.sockets.length, count + 1);
    assert.equal(h.supervisor.getState().kind, "connecting");
    h.sockets.at(-1).socket.open(); await flush();
    await h.clock.tick(120_000);
    assert.equal(h.supervisor.getState().kind, "connected");
    assert.equal(h.clock.tasks.size, 0);
  } finally { h.supervisor.dispose(); }
});

test("offline stops all timers and network recovery bypasses the silent wait", async () => {
  const h = await harness();
  try {
    h.network(false);
    assert.equal(h.supervisor.getState().kind, "offline");
    assert.equal(h.clock.tasks.size, 0);
    const count = h.sockets.length;
    await h.clock.tick(120_000);
    assert.equal(h.sockets.length, count);
    h.network(true);
    assert.equal(h.sockets.length, count + 1);
    await h.clock.tick(30_000);
    const quietCount = h.sockets.length;
    h.network(true);
    assert.equal(h.sockets.length, quietCount + 1);
  } finally { h.supervisor.dispose(); }
});

test("backgrounding suspends socket attempts and foregrounding tries immediately", async () => {
  const h = await harness();
  try {
    await h.clock.tick(30_000);
    h.lifecycle(false);
    assert.equal(h.clock.tasks.size, 0);
    const count = h.sockets.length;
    await h.clock.tick(120_000);
    assert.equal(h.sockets.length, count);
    h.lifecycle(true);
    assert.equal(h.sockets.length, count + 1);
    assert.equal(h.supervisor.getState().kind, "connecting");
  } finally { h.supervisor.dispose(); }
});

test("authorization and version failures remain terminal across network and lifecycle events", async () => {
  for (const mismatch of [false, true]) {
    const h = await harness({ onConnected: mismatch ? async () => { throw new ProtocolMismatchError("Update required"); } : undefined });
    try {
      if (mismatch) { h.sockets[0].socket.open(); await flush(); }
      else h.sockets[0].socket.drop("401 unauthorized", 1008);
      const expected = mismatch ? "incompatible" : "authBlocked";
      assert.equal(h.supervisor.getState().kind, expected);
      const count = h.sockets.length;
      h.network(false); h.network(true); h.lifecycle(false); h.lifecycle(true); h.supervisor.retry();
      await h.clock.tick(120_000);
      assert.equal(h.sockets.length, count);
      assert.equal(h.supervisor.getState().kind, expected);
    } finally { h.supervisor.dispose(); }
  }
});

test("synchronous socket creation failures rotate and settle into a slow retry", async () => {
  const h = await harness({ factoryFailure: true });
  try {
    await h.clock.tick(3000);
    assert.equal(h.supervisor.getState().kind, "unreachable");
  } finally { h.supervisor.dispose(); }
  assert.equal(h.clock.tasks.size, 0);
});

test("rotating addresses does not restart the thirty-second recovery budget", async () => {
  const h = await harness();
  try {
    h.sockets.at(-1).socket.drop(); await h.clock.tick(500);
    h.sockets.at(-1).socket.drop(); await h.clock.tick(1000);
    h.sockets.at(-1).socket.drop();
    assert.equal(h.sockets.at(-1).endpoint, "ws://mac-b");
    await h.clock.tick(28_500);
    assert.equal(h.supervisor.getState().kind, "unreachable");
  } finally { h.supervisor.dispose(); }
});

test("failed sync retries are bounded and quiet-probe failures cannot flash Syncing", async () => {
  const h = await harness({ onConnected: async () => { throw new Error("Sync unavailable"); } });
  try {
    h.sockets[0].socket.open(); await flush();
    await h.clock.tick(30_000);
    assert.equal(h.supervisor.getState().kind, "unreachable");
    await h.clock.tick(30_000);
    const count = h.states.length;
    h.sockets.at(-1).socket.open(); await flush();
    assert.equal(h.supervisor.getState().kind, "unreachable");
    assert.ok(h.states.slice(count).every((state) => state.kind === "unreachable"));
  } finally { h.supervisor.dispose(); }
});
