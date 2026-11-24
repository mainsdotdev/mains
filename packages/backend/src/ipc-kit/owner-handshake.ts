import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import { OWNER_HELLO, OWNER_NONCE, OWNER_READY, ownerProofMessage } from "@mains/contracts/connect-owner";

function mac(token: string, message: string) {
  return createHmac("sha256", token).update(message).digest("hex");
}
function matches(expected: string, actual: string) {
  return OWNER_NONCE.test(actual) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function ownerHello(protocols: readonly string[], token: string): string | null {
  const hello = protocols.find(p => p.startsWith(OWNER_HELLO));
  if (!hello) return null;
  const parts = hello.slice(OWNER_HELLO.length).split(".");
  if (parts.length !== 2 || !OWNER_NONCE.test(parts[0])) return null;
  return matches(mac(token, ownerProofMessage("hello", parts[0])), parts[1]) ? parts[0] : null;
}

// A hello proves knowledge of the key but may be replayed. Install the RPC
// router only after this socket answers the independently generated challenge.
export function verifyOwnerSocket(socket: WebSocket, token: string, client: string, id: string, admit: () => void) {
  const server = randomBytes(32).toString("hex");
  const timer = setTimeout(() => socket.terminate(), 8000);
  timer.unref();
  socket.once("close", () => clearTimeout(timer));
  socket.once("message", (frame, binary) => {
    clearTimeout(timer);
    if (binary || !Buffer.isBuffer(frame) || frame.length !== 64 || !matches(mac(token, ownerProofMessage("client", client, server, id)), frame.toString())) {
      socket.terminate();
      return;
    }
    socket.send(OWNER_READY);
    admit();
  });
  socket.send(JSON.stringify([id, server, mac(token, ownerProofMessage("server", client, server, id))]));
}
