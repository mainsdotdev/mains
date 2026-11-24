// Separate domains keep a server proof from being usable as a client response.
export const OWNER_HELLO = "mains.owner.v1.";
export const OWNER_READY = "mains.owner.ready";
export const OWNER_NONCE = /^[a-f0-9]{64}$/;
export function ownerProofMessage(role: "hello" | "server" | "client", client: string, server = "", backendId = ""): string {
  return JSON.stringify(["mains.owner.v1", role, client, server, backendId]);
}
