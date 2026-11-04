import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRelaySession, relaySharedKey, relayPublicKey, encodeKey, decodeKey } from "../src/crypto.ts";

function peers(device = "phone") {
  const serverKey = randomBytes(32), clientKey = randomBytes(32);
  const clientNonce = encodeKey(randomBytes(32)), serverNonce = encodeKey(randomBytes(32));
  const sharedA = relaySharedKey(clientKey, relayPublicKey(serverKey));
  const sharedB = relaySharedKey(serverKey, relayPublicKey(clientKey));
  return {
    client: createRelaySession(sharedA, "backend", device, clientNonce, serverNonce),
    server: createRelaySession(sharedB, "backend", device, clientNonce, serverNonce),
    shared: sharedA, clientNonce, serverNonce,
  };
}

test("direction keys interoperate and reject reflection, corruption and replay", () => {
  const { client, server } = peers();
  const frame = client.toBackend.seal("a private prompt");
  assert.throws(() => server.toDevice.open(frame));
  assert.throws(() => server.toBackend.open({ ...frame, ciphertext: frame.ciphertext.slice(0, -1) + (frame.ciphertext.endsWith("A") ? "B" : "A") }));
  assert.equal(server.toBackend.open(frame), "a private prompt");
  assert.throws(() => server.toBackend.open(frame), /sequence/);
  assert.equal(client.toDevice.open(server.toDevice.seal("a private reply")), "a private reply");
});

test("fresh backend challenges and device identity fence captured authentication", () => {
  const { client, shared, clientNonce, serverNonce } = peers();
  const captured = client.toBackend.seal("device-token");
  const replayed = createRelaySession(shared, "backend", "phone", clientNonce, encodeKey(randomBytes(32)));
  const otherDevice = createRelaySession(shared, "backend", "other-phone", clientNonce, serverNonce);
  assert.throws(() => replayed.toBackend.open(captured));
  assert.throws(() => otherDevice.toBackend.open(captured));
});

test("supports bounded UTF-8 file/history frames and rejects excess before encryption", () => {
  const { client, server } = peers();
  const value = "a".repeat(4 * 1024 * 1024);
  assert.equal(server.toBackend.open(client.toBackend.seal(value)), value);
  assert.throws(() => client.toBackend.seal(value + "x"), /limit/);
  assert.throws(() => client.toBackend.seal("ö".repeat(3 * 1024 * 1024)), /limit/);
});

test("large frames encode on runtimes with a 4096-argument variadic call limit", () => {
  const bytes = randomBytes(32 * 1024);
  const fromCharCode = String.fromCharCode;
  String.fromCharCode = (...values) => {
    if (values.length > 4096) throw new RangeError("Hermes argument limit exceeded");
    return fromCharCode(...values);
  };
  try { assert.deepEqual(decodeKey(encodeKey(bytes)), new Uint8Array(bytes)); }
  finally { String.fromCharCode = fromCharCode; }
});
