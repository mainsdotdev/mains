import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { BRIDGE_PROTOCOL_VERSION, type BridgeBody, type BridgeEnvelope, type BridgeHeader } from "@mains/contracts/bridge-protocol";
import { validateBridgeHeader, validateEncryptedBridgeEnvelope } from "@mains/contracts/bridge-wire";
import { fromBase64Url, toBase64Url, utf8 } from "./bridge.encoding";
import { deriveBridgeKeys } from "./bridge.keys";

export interface BridgeCodec {
  seal(header: BridgeHeader, body: BridgeBody): BridgeEnvelope;
  open(envelope: BridgeEnvelope): { header: BridgeHeader; body: BridgeBody };
}

export function bridgeRecordKeys(key: Uint8Array, table: string, pk: string, register?: string) {
  if (key.byteLength !== 32) throw new Error("Bridge record key must contain 32 bytes");
  const digest = (value: string) => toBase64Url(hmac(sha256, key, utf8(value)).subarray(0, 16));
  return {
    rowKey: digest(`${table}:${pk}`),
    ...(register === undefined ? {} : { registerKey: digest(`${table}:${pk}:${register}`) }),
  };
}

/** A fixed field order authenticates the complete routing header independently of JSON key order. */
export function bridgeHeaderAad(header: BridgeHeader): Uint8Array {
  validateBridgeHeader(header);
  return utf8(JSON.stringify([header.v, header.stream, header.rowKey, header.registerKey ?? null,
    header.hlc.physicalMs, header.hlc.counter, header.origin, header.op, header.owner ?? null, header.runId ?? null]));
}

export function createBridgeSealingCodec(accountKey: Uint8Array): BridgeCodec {
  const keys = deriveBridgeKeys(accountKey);
  const verifyIdentity = (header: BridgeHeader, body: BridgeBody) => {
    const expected = bridgeRecordKeys(keys.recordKey, body.table, body.pk, "register" in body ? body.register : undefined);
    if (header.rowKey !== expected.rowKey || header.registerKey !== expected.registerKey) throw new Error("Bridge encrypted record identity mismatch");
  };
  return {
    seal(header, body) {
      validateRecord(header, body); verifyIdentity(header, body);
      const nonce = randomBytes(24);
      const ciphertext = xchacha20poly1305(keys.bodyKey, nonce, bridgeHeaderAad(header)).encrypt(utf8(JSON.stringify(body)));
      const envelope = { header: structuredClone(header), body: { nonce: toBase64Url(nonce), payload: toBase64Url(ciphertext) } };
      validateEncryptedBridgeEnvelope(envelope);
      return envelope;
    },
    open(envelope) {
      validateEncryptedBridgeEnvelope(envelope);
      let plaintext: Uint8Array;
      try { plaintext = xchacha20poly1305(keys.bodyKey, fromBase64Url(envelope.body.nonce!, 24), bridgeHeaderAad(envelope.header)).decrypt(fromBase64Url(envelope.body.payload)); }
      catch { throw new Error("Bridge record authentication failed"); }
      try {
        const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
        validateRecord(envelope.header, body); verifyIdentity(envelope.header, body);
        return { header: structuredClone(envelope.header), body };
      } finally { plaintext.fill(0); }
    },
  };
}

/** In-memory tests only. The WebSocket transport and hub reject this plaintext format. */
export const bridgePassThroughCodec: BridgeCodec = {
  seal(header, body) {
    validateRecord(header, body);
    return { header: structuredClone(header), body: { nonce: null, payload: JSON.stringify(body) } };
  },
  open(envelope) {
    if (envelope.body.nonce !== null) throw new Error("Encrypted record requires the sealing codec");
    const body: unknown = JSON.parse(envelope.body.payload);
    validateRecord(envelope.header, body);
    return { header: structuredClone(envelope.header), body: body as BridgeBody };
  },
};

function validateRecord(header: BridgeHeader, value: unknown): asserts value is BridgeBody {
  if (header.v !== BRIDGE_PROTOCOL_VERSION || typeof header.origin !== "string" || !header.origin ||
      typeof header.rowKey !== "string" || !header.rowKey ||
      (header.owner !== undefined && (typeof header.owner !== "string" || !header.owner)) ||
      (header.runId !== undefined && (typeof header.runId !== "string" || !header.runId)) ||
      (header.stream !== "account" && !/^run:.+/.test(header.stream)) ||
      !Number.isSafeInteger(header.hlc.physicalMs) || header.hlc.physicalMs < 0 ||
      !Number.isSafeInteger(header.hlc.counter) || header.hlc.counter < 0)
    throw new Error("Invalid Bridge record header");
  if (!value || typeof value !== "object") throw new Error("Invalid Bridge record body");
  const body = value as Record<string, unknown>;
  if (typeof body.table !== "string" || !body.table || typeof body.pk !== "string" || !body.pk)
    throw new Error("Invalid Bridge record identity");
  if (header.op === "delete") {
    if (header.registerKey !== undefined || Object.keys(body).some((key) => key !== "table" && key !== "pk"))
      throw new Error("Bridge deletes are minimal row-level records");
  } else if (header.op !== "upsert" || typeof header.registerKey !== "string" || !header.registerKey || typeof body.register !== "string" || !body.register ||
      !Number.isSafeInteger(body.schemaVersion) || (body.schemaVersion as number) < 1 ||
      !body.values || typeof body.values !== "object" || Array.isArray(body.values) ||
      !body.refs || typeof body.refs !== "object" || Array.isArray(body.refs) || !Array.isArray(body.blobRefs)) {
    throw new Error("Invalid Bridge upsert");
  }
  if (header.op === "upsert") {
    const values = (value as BridgeBody & { values: Record<string, unknown> }).values;
    if (Object.values(values).some((entry) => entry !== null &&
        !["string", "number", "boolean"].includes(typeof entry) || typeof entry === "number" && !Number.isFinite(entry)))
      throw new Error("Bridge values must be portable SQLite scalars");
  }
}
