import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRelaySocket } from "../src/socket.ts";
import { relayPublicKey } from "../src/crypto.ts";

test("an untrusted relay cannot turn a routing refusal into device revocation", () => {
  for (const rawCode of [1006, 1008]) {
    const raw = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} };
    const socket = createRelaySocket({ url: "ws://127.0.0.1:8791", ticket: "routing-only", backendPublicKey: relayPublicKey(randomBytes(32)), expiresAt: "2099-01-01" },
      { backendId: "backend", deviceId: "phone", deviceToken: "private-device-token" }, () => raw, randomBytes);
    let closed;
    socket.onclose = (event) => { closed = event; };
    raw.onclose({ code: rawCode, reason: "401 unauthorized" });
    assert.deepEqual(closed, { code: 1006, reason: "Relay connection closed" });
    assert.equal(socket.readyState, 3);
    raw.onopen();
    assert.equal(socket.readyState, 3);
  }
});
