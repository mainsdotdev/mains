import { randomUUID } from "node:crypto";
import type { BridgeLogRecord, BridgeStream } from "@mains/contracts/bridge-protocol";
import { createMemoryBridgeHub, type BridgeTransport } from "../src/modules/bridge/bridge.transport";
import { createBridgeWebSocketTransport } from "../src/modules/bridge/bridge.websocket";
import { bridgePassThroughCodec, createBridgeSealingCodec } from "../src/modules/bridge/bridge.crypto";
import { deriveBridgeKeys } from "../src/modules/bridge/bridge.keys";

export const networkMode = process.env.MAINS_BRIDGE_TEST_TRANSPORT === "ws";
export const bridgeTestAccountKey = new Uint8Array(32).fill(17);
export const bridgeTestCodec = networkMode ? createBridgeSealingCodec(bridgeTestAccountKey) : bridgePassThroughCodec;
export const bridgeTestRecordKey = networkMode ? deriveBridgeKeys(bridgeTestAccountKey).recordKey : bridgeTestAccountKey;
export interface BridgeTestHub {
  connect(backendId: string): BridgeTransport;
  inspect(stream: BridgeStream): BridgeLogRecord[] | Promise<BridgeLogRecord[]>;
  compact(): void | Promise<void>;
}
export interface LocalBridgeTestWorker {
  readonly url: string; readonly wsUrl: string;
  token(accountId: string, backendId: string, expiresIn?: string | number): Promise<string>;
  restart(): Promise<void>; dispose(): Promise<void>; inspect(accountId: string): Promise<unknown>; evict(accountId: string): Promise<void>;
}
let worker: Promise<LocalBridgeTestWorker> | undefined;
const clients = new Set<ReturnType<typeof createBridgeWebSocketTransport>>();
async function startWorker(): Promise<LocalBridgeTestWorker> {
  // Production apps/bridge imports contracts only. This test helper starts its real workerd runtime.
  const location = new URL("../../../apps/bridge/test/local-hub.mjs", import.meta.url).href;
  const { startLocalBridgeHub } = await import(/* @vite-ignore */ location);
  return startLocalBridgeHub();
}
export async function getLocalBridgeTestWorker() { return worker ??= startWorker(); }
export async function createBridgeTestHub(): Promise<BridgeTestHub> {
  if (!networkMode) return createMemoryBridgeHub();
  const hub = await (worker ??= startWorker());
  const accountId = randomUUID();
  const transports = new Map<string, ReturnType<typeof createBridgeWebSocketTransport>>();
  const connect = (backendId: string) => {
    let transport = transports.get(backendId);
    if (!transport) {
      transport = createBridgeWebSocketTransport({ url: hub.wsUrl, token: () => hub.token(accountId, backendId) });
      transports.set(backendId, transport); clients.add(transport);
    }
    return transport;
  };
  return {
    connect,
    async inspect(stream) {
      const result: BridgeLogRecord[] = []; let after = 0;
      for (;;) {
        const page = await connect("inspector").pull(stream, after, 1000);
        result.push(...page.records); after = page.next;
        if (!page.hasMore) return result;
      }
    },
    async compact() { await connect("inspector").compact(); },
  };
}
export function closeBridgeTestConnections() { for (const client of clients) client.close(); clients.clear(); }
export async function disposeBridgeTestHub() { closeBridgeTestConnections(); if (worker) await (await worker).dispose(); worker = undefined; }
