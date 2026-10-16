import { BRIDGE_PROTOCOL_VERSION, type BridgeEnvelope, type BridgeHeader, type BridgeRpcRequest, type BridgeRpcResponse, type BridgeServerMessage, type BridgeStream } from "./bridge-protocol";
import { validateBridgeBlobIdentity } from "./bridge-blobs";
import { isBridgeVerificationCode } from "./bridge-auth";

// Leave room for routing columns below the Durable Object SQL row/string limit (2 MB).
export const BRIDGE_MAX_RECORD_BYTES = 1024 * 1024;
export const BRIDGE_MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const BRIDGE_MAX_BATCH = 100;
export const BRIDGE_MAX_SUBSCRIPTIONS = 128;
export const isBridgeStream = (value: unknown): value is BridgeStream => typeof value === "string" && (value === "account" || /^run:[A-Za-z0-9_-]{1,128}$/.test(value));
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safeClock = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const opaqueKey = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{22}$/.test(value);

/** Header-only validation. The hub never imports record schemas or opens bodies. */
export function validateBridgeHeader(value: unknown): asserts value is BridgeHeader {
  if (!object(value) || Object.keys(value).some((key) => !["v", "stream", "rowKey", "registerKey", "hlc", "origin", "op", "owner", "runId", "retention", "blobs"].includes(key)) ||
      value.v !== BRIDGE_PROTOCOL_VERSION || !isBridgeStream(value.stream) || !identifier(value.origin) ||
      !opaqueKey(value.rowKey) || !object(value.hlc) || Object.keys(value.hlc).length !== 2 ||
      !safeClock(value.hlc.physicalMs) || !safeClock(value.hlc.counter) ||
      value.owner !== undefined && !identifier(value.owner) || value.runId !== undefined && !identifier(value.runId) ||
      value.retention !== undefined && (value.retention !== "30d-idle" || value.op !== "upsert" || value.stream === "account" || !value.owner || value.stream !== `run:${value.runId}`) ||
      value.op !== "upsert" && value.op !== "delete" ||
      value.op === "upsert" && !opaqueKey(value.registerKey) || value.op === "delete" && (value.registerKey !== undefined || value.blobs !== undefined))
    throw new Error("Invalid Bridge header");
  if (value.blobs !== undefined) {
    if (!Array.isArray(value.blobs) || value.blobs.length > 64) throw new Error("Invalid Bridge blob roots");
    for (const [index, blob] of value.blobs.entries()) {
      validateBridgeBlobIdentity(blob);
      if (Object.keys(blob).length !== 2 || index > 0 && value.blobs[index - 1].blobId >= blob.blobId) throw new Error("Invalid Bridge blob roots");
    }
  }
}

export function validateEncryptedBridgeEnvelope(value: unknown): asserts value is BridgeEnvelope {
  if (!object(value)) throw new Error("Invalid Bridge envelope");
  validateBridgeHeader(value.header);
  if (Object.keys(value).some((key) => key !== "header" && key !== "body") || !object(value.body) ||
      Object.keys(value.body).length !== 2 || typeof value.body.nonce !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(value.body.nonce) ||
      typeof value.body.payload !== "string" || !/^[A-Za-z0-9_-]{22,}$/.test(value.body.payload) ||
      new TextEncoder().encode(JSON.stringify(value)).length > BRIDGE_MAX_RECORD_BYTES)
    throw new Error("Bridge accepts encrypted envelopes only");
}

export function parseBridgeRpcRequest(text: string): BridgeRpcRequest {
  if (new TextEncoder().encode(text).length > BRIDGE_MAX_FRAME_BYTES) throw new Error("Bridge message is too large");
  const request: unknown = JSON.parse(text);
  if (!object(request) || !identifier(request.requestId) || !object(request.message)) throw new Error("Invalid Bridge request");
  const message = request.message;
  switch (message.type) {
    case "hello":
      if (typeof message.label !== "string" || !message.label.trim() || message.label.length > 128 ||
          typeof message.platform !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(message.platform)) throw new Error("Invalid Bridge backend metadata");
      break;
    case "push":
      if (!isBridgeStream(message.stream) || !Array.isArray(message.records) || message.records.length > BRIDGE_MAX_BATCH) throw new Error("Invalid Bridge push");
      message.records.forEach(validateEncryptedBridgeEnvelope); break;
    case "pull":
      if (!isBridgeStream(message.stream) || !safeClock(message.after) || !Number.isSafeInteger(message.limit) || message.limit < 1 || message.limit > 1000) throw new Error("Invalid Bridge pull");
      break;
    case "subscribe":
      if (!Array.isArray(message.streams) || message.streams.length > BRIDGE_MAX_SUBSCRIPTIONS || !message.streams.every(isBridgeStream)) throw new Error("Invalid Bridge subscription");
      break;
    case "compact": break;
    default: throw new Error("Unknown Bridge request");
  }
  return request as unknown as BridgeRpcRequest;
}

/** A hub response is untrusted even after a successful WebSocket handshake. */
export function parseBridgeServerFrame(text: string): BridgeRpcResponse | BridgeServerMessage {
  if (new TextEncoder().encode(text).length > BRIDGE_MAX_FRAME_BYTES) throw new Error("Bridge message is too large");
  const frame: unknown = JSON.parse(text);
  if (!object(frame)) throw new Error("Invalid Bridge response");
  if ("requestId" in frame && frame.type !== "approval") {
    if (!identifier(frame.requestId)) throw new Error("Invalid Bridge response id");
    if ("error" in frame) {
      if (!object(frame.error) || typeof frame.error.code !== "string" || !frame.error.code || frame.error.code.length > 128 ||
          typeof frame.error.message !== "string" || "message" in frame) throw new Error("Invalid Bridge error");
      return frame as unknown as BridgeRpcResponse;
    }
    validateServerMessage(frame.message);
  } else {
    validateServerMessage(frame);
    if (frame.type !== "presence" && frame.type !== "changed" && frame.type !== "approval") throw new Error("Uncorrelated Bridge response");
  }
  return frame as unknown as BridgeRpcResponse | BridgeServerMessage;
}

function validateServerMessage(message: unknown): asserts message is BridgeServerMessage {
  if (!object(message)) throw new Error("Invalid Bridge response message");
  switch (message.type) {
    case "identified": if (!identifier(message.backendId)) throw new Error("Invalid Bridge backend identity"); break;
    case "ack":
      if (!isBridgeStream(message.stream) || !Array.isArray(message.results) || message.results.length > BRIDGE_MAX_BATCH) throw new Error("Invalid Bridge ACK");
      for (const result of message.results) {
        if (!object(result) || Object.keys(result).length !== 1) throw new Error("Invalid Bridge ACK result");
        if ("seq" in result) { if (!safeClock(result.seq) || result.seq < 1) throw new Error("Invalid Bridge ACK sequence"); }
        else if ("deleted" in result) {
          validateEncryptedBridgeEnvelope(result.deleted);
          if (result.deleted.header.op !== "delete") throw new Error("Invalid Bridge deleted ACK");
        } else if (!["notOwner", "quotaExceeded", "rateLimited", "subscriptionRequired", "blobMissing"].includes(result.error)) throw new Error("Invalid Bridge ACK error");
      }
      break;
    case "records":
      if (!isBridgeStream(message.stream) || !safeClock(message.next) || typeof message.hasMore !== "boolean" ||
          !Array.isArray(message.records) || message.records.length > 1000) throw new Error("Invalid Bridge records");
      for (const record of message.records) {
        if (!object(record) || !safeClock(record.seq) || record.seq < 1) throw new Error("Invalid Bridge log record");
        validateEncryptedBridgeEnvelope(record.envelope);
      }
      break;
    case "subscribed":
      if (!Array.isArray(message.streams) || message.streams.length > BRIDGE_MAX_SUBSCRIPTIONS || !message.streams.every(isBridgeStream)) throw new Error("Invalid Bridge subscription");
      break;
    case "compacted": break;
    case "changed": if (!isBridgeStream(message.stream)) throw new Error("Invalid Bridge change hint"); break;
    case "approval":
      if (!identifier(message.requestId) || !identifier(message.backendId) || typeof message.publicKey !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(message.publicKey) || typeof message.label !== "string" || !message.label || message.label.length > 128 ||
        typeof message.platform !== "string" || !message.platform || message.platform.length > 32 || !isBridgeVerificationCode(message.code) ||
        typeof message.expiresAt !== "string" || !Number.isFinite(Date.parse(message.expiresAt))) throw new Error("Invalid Bridge approval");
      break;
    case "presence":
      if (!identifier(message.backendId) || typeof message.online !== "boolean" || typeof message.lastSeen !== "string" ||
          !Number.isFinite(Date.parse(message.lastSeen)) || message.label !== undefined && (typeof message.label !== "string" || !message.label.trim() || message.label.length > 128) ||
          message.platform !== undefined && (typeof message.platform !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(message.platform))) throw new Error("Invalid Bridge presence");
      break;
    default: throw new Error("Unknown Bridge response");
  }
}
