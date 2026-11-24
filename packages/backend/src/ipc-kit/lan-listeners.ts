import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import type { RequestListener } from "node:http";
import { networkInterfaces } from "node:os";
import type { Server as HttpsServer } from "node:https";
import type { WebSocketServer } from "ws";
import { isConnectLoopback } from "@mains/contracts/connect-endpoint";

export function privateLanAddresses(interfaces = networkInterfaces()): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const [a, b] = entry.address.split(".").map(Number);
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses].sort((a, b) =>
    Number(a.startsWith("100.")) - Number(b.startsWith("100.")) || a.localeCompare(b));
}

export function readLanTls(certFile = process.env.MAINS_TLS_CERT, keyFile = process.env.MAINS_TLS_KEY) {
  if (!certFile || !keyFile) throw new Error("LAN access requires MAINS_TLS_CERT and MAINS_TLS_KEY, or use Tailscale HTTPS.");
  return { cert: readFileSync(certFile), key: readFileSync(keyFile) };
}

export function createLanListeners(host: string, handler: RequestListener, tls?: ReturnType<typeof readLanTls>) {
  if (isConnectLoopback(host)) return [];
  const addresses = ["0.0.0.0", "::", "[::]"].includes(host) ? privateLanAddresses() : [host.replace(/^\[|\]$/g, "")];
  if (!addresses.length) throw new Error("No private IPv4 interface is available for LAN access.");
  const credentials = tls ?? readLanTls();
  return addresses.map(address => ({ address, server: createServer(credentials, handler) }));
}

export async function listenLan(server: HttpsServer, address: string, port: number, wss: WebSocketServer) {
  server.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req)));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, () => {
      server.off("error", reject);
      server.on("error", error => wss.emit("error", error));
      resolve();
    });
  });
}
