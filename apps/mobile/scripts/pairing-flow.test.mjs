import assert from "node:assert/strict";
import { test } from "node:test";
import { createPairingFlow } from "../src/features/pairing/pairing-flow.ts";
import { createCredentialPersistence } from "../src/backend/credential-persistence.ts";

const link = { code: "first", name: "Computer", endpoints: ["http://computer:8787"] };
const backend = { backendId: "computer", name: "Computer", endpoints: link.endpoints, deviceId: "phone", deviceToken: "token", pairedAt: "2026-01-01", appVersion: "1", protocolVersion: 1 };

test("clipboard refusal leaves pairing usable without an unhandled rejection", async () => {
  const flow = createPairingFlow(link, { redeem: async () => backend, save: async () => {}, complete: () => {} });
  const detach = flow.attach();
  await flow.paste(async () => { throw new Error("Clipboard access denied"); }, () => assert.fail("no clipboard value"));
  assert.deepEqual(flow.getSnapshot(), { kind: "detected", link });
  assert.equal(await flow.pair(link), true);
  detach();
});

test("pairing joins duplicate activation and retires a late result on a new scanned link", async () => {
  let finish, calls = 0, writes = 0, completions = 0;
  const flow = createPairingFlow(link, {
    redeem: async () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
    save: async () => { writes++; }, complete: () => { completions++; },
  });
  const detach = flow.attach();
  const first = flow.pair(link), duplicate = flow.pair(link);
  assert.equal(first, duplicate);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  const replacement = { ...link, code: "replacement" };
  flow.detect(replacement); finish(backend);
  assert.equal(await first, false);
  assert.equal(writes, 0); assert.equal(completions, 0);
  assert.deepEqual(flow.getSnapshot(), { kind: "detected", link: replacement });
  detach();
});

test("leaving the screen retires redemption before storage and navigation", async () => {
  let finish, saves = 0, completions = 0;
  const flow = createPairingFlow(link, {
    redeem: async () => new Promise((resolve) => { finish = resolve; }),
    save: async () => { saves++; }, complete: () => { completions++; },
  });
  const detach = flow.attach();
  const pairing = flow.pair(link);
  await new Promise((resolve) => setImmediate(resolve));
  detach(); finish(backend);
  assert.equal(await pairing, false);
  assert.equal(saves, 0); assert.equal(completions, 0);
});

test("a new scanned link during native storage rolls back the old pairing", async () => {
  let value = "previous", finish, entered, completions = 0;
  const writing = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { finish = resolve; });
  const storage = createCredentialPersistence({
    read: async () => value,
    write: async (next) => { if (next === "candidate") { entered(); await gate; } value = next; },
    remove: async () => { value = null; },
  });
  const flow = createPairingFlow(link, {
    redeem: async () => backend,
    save: (_, signal) => storage.save("candidate", signal), complete: () => { completions++; },
  });
  const detach = flow.attach();
  const pairing = flow.pair(link);
  await writing; flow.detect({ ...link, code: "replacement" }); finish();
  assert.equal(await pairing, false);
  assert.equal(await storage.load(), "previous");
  assert.equal(completions, 0);
  assert.equal(flow.getSnapshot().link.code, "replacement");
  detach();
});

test("a pending paste cannot overwrite a later manual selection", async () => {
  let finish, shown = 0;
  const flow = createPairingFlow(null, { redeem: async () => backend, save: async () => {}, complete: () => {} });
  const detach = flow.attach();
  const pasting = flow.paste(() => new Promise((resolve) => { finish = resolve; }), () => { shown++; });
  flow.accept("mains://pair#code=manual&endpoint=http%3A%2F%2Fcomputer%3A8787");
  finish("mains://pair#code=clipboard&endpoint=http%3A%2F%2Fcomputer%3A8787");
  await pasting;
  assert.equal(shown, 0); assert.equal(flow.getSnapshot().link.code, "manual");
  detach();
});

test("persistence failure blocks completion and successful retry completes only once", async () => {
  let saves = 0, completions = 0;
  const flow = createPairingFlow(link, {
    redeem: async () => backend,
    save: async () => { if (++saves === 1) throw new Error("Keychain locked"); },
    complete: () => { completions++; },
  });
  const detach = flow.attach();
  assert.equal(await flow.pair(link), false);
  assert.equal(completions, 0); assert.equal(flow.getSnapshot().message, "Keychain locked");
  assert.equal(await flow.pair(link), true);
  assert.equal(flow.getSnapshot().kind, "paired");
  assert.equal(await flow.pair(link), false);
  assert.equal(completions, 1); assert.equal(saves, 2);
  detach();
});
