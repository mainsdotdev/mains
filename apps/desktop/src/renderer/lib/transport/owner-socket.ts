import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { OWNER_HELLO, OWNER_NONCE, OWNER_READY, ownerProofMessage } from "@mains/contracts/connect-owner";
import { WS_SUBPROTOCOL } from "@mains/contracts/ws-protocol";
import type { WebSocketLike, WsTransportOptions } from "./ws-transport";

/** A reconnect must prove the same identity before the transport releases queued calls. */
export function ownerSocketFactory(token: string, expectedId?: string, factory?: WsTransportOptions["factory"]) {
  const encoder = new TextEncoder();
  const secret = encoder.encode(token);
  let pinnedId = expectedId;

  return (url: string): WebSocketLike => {
    const client = bytesToHex(randomBytes(32));
    function proof(role: "hello" | "client" | "server", server = "", id = "") {
      const message = encoder.encode(ownerProofMessage(role, client, server, id));
      return bytesToHex(hmac(sha256, secret, message));
    }
    const protocols = [WS_SUBPROTOCOL, OWNER_HELLO + client + "." + proof("hello")];
    const raw = factory ? factory(url, protocols) : new WebSocket(url, protocols) as unknown as WebSocketLike;
    let phase: "challenge" | "confirm" | "ready" | "closed" = "challenge";
    let verificationFailed = false;
    const socket: WebSocketLike = {
      get readyState() {
        if (phase === "ready") return raw.readyState;
        return phase === "closed" ? 3 : 0;
      },
      send(data) {
        if (phase !== "ready") throw new Error("Server verification is pending");
        raw.send(data);
      },
      close() {
        phase = "closed";
        raw.close();
      },
      onopen: null, onclose: null, onerror: null, onmessage: null,
    };

    raw.onerror = event => socket.onerror?.(event);
    raw.onclose = event => {
      phase = "closed";
      socket.onclose?.(verificationFailed ? { code: 4401, reason: "Server identity verification failed" } : event);
    };
    raw.onmessage = event => {
      if (phase === "closed") return;
      if (phase === "ready") {
        socket.onmessage?.(event);
        return;
      }
      if (phase === "confirm" && event.data === OWNER_READY) {
        phase = "ready";
        socket.onopen?.();
        return;
      }
      if (phase === "challenge" && typeof event.data === "string" && event.data.length <= 1024) {
        try {
          const reply: unknown = JSON.parse(event.data);
          if (Array.isArray(reply) && reply.length === 3) {
            const [id, nonce, signature] = reply;
            if (typeof id === "string" && id && (!pinnedId || pinnedId === id) &&
                typeof nonce === "string" && OWNER_NONCE.test(nonce) && signature === proof("server", nonce, id)) {
              pinnedId = id;
              phase = "confirm";
              raw.send(proof("client", nonce, id));
              return;
            }
          }
        } catch { /* Reject an invalid challenge or failed response below. */ }
      }
      verificationFailed = true;
      socket.close();
    };
    return socket;
  };
}
