import assert from "node:assert/strict";
import { test } from "node:test";
import { createCredentialPersistence } from "../src/backend/credential-persistence.ts";

test("a canceled native credential write restores the previous record before queued forget", async () => {
  let value = "previous", finish, entered;
  const writing = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { finish = resolve; });
  const store = createCredentialPersistence({
    read: async () => value,
    write: async (next) => { if (next === "candidate") { entered(); await gate; } value = next; },
    remove: async () => { value = null; },
  });
  const controller = new AbortController();
  const saving = store.save("candidate", controller.signal);
  const outcome = saving.catch((error) => error);
  await writing;
  controller.abort(); const forgetting = store.forget(); finish();
  assert.match((await outcome).message, /no longer active/);
  await forgetting;
  assert.equal(value, null); assert.equal(await store.load(), null);
});

test("cancellation restores the previous pairing and a later save can commit", async () => {
  let value = "previous", finish, entered;
  const writing = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { finish = resolve; });
  const store = createCredentialPersistence({
    read: async () => value,
    write: async (next) => { if (next === "abandoned") { entered(); await gate; } value = next; },
    remove: async () => { value = null; },
  });
  const controller = new AbortController();
  const saving = store.save("abandoned", controller.signal).catch((error) => error);
  await writing; controller.abort(); finish();
  assert.match((await saving).message, /no longer active/);
  assert.equal(await store.load(), "previous");
  await store.save("replacement");
  assert.equal(await store.load(), "replacement");
});

test("a failed rollback keeps an unconfirmed credential hidden until recovery succeeds", async () => {
  let value = null, denyRemoval = true;
  const controller = new AbortController();
  const store = createCredentialPersistence({
    read: async () => value,
    write: async (next) => { value = next; controller.abort(); },
    remove: async () => { if (denyRemoval) throw new Error("Keychain locked"); value = null; },
  });
  await assert.rejects(store.save("candidate", controller.signal), /Keychain locked/);
  await assert.rejects(store.load(), /Keychain locked/);
  denyRemoval = false;
  assert.equal(await store.load(), null);
});

test("a newer save supersedes a pending write and readers wait for the confirmed result", async () => {
  let value = null, finish, entered;
  const writing = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { finish = resolve; });
  const store = createCredentialPersistence({
    read: async () => value,
    write: async (next) => { if (next === "first") { entered(); await gate; } value = next; },
    remove: async () => { value = null; },
  });
  const first = store.save("first").catch((error) => error);
  await writing;
  const reading = store.load(), second = store.save("second");
  finish();
  assert.match((await first).message, /no longer active/);
  await second;
  assert.equal(await reading, "second");
});
