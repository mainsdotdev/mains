/** Bridge v1 wire contract. No Electron, database, or crypto implementation here. */
export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export type BridgeStream = "account" | `run:${string}`;
export interface BridgeHlc { physicalMs: number; counter: number }
interface BridgeHeaderBase {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  stream: BridgeStream;
  rowKey: string;
  hlc: BridgeHlc;
  origin: string;
  owner?: string;
  /** Authenticated binding between a run's opaque root key and its public stream. */
  runId?: string;
}
export type BridgeHeader = BridgeHeaderBase & (
  | { op: "upsert"; registerKey: string }
  | { op: "delete"; registerKey?: never }
);
export type BridgeValue = string | number | boolean | null;
export interface BridgeUpsertBody {
  table: string;
  pk: string;
  register: string;
  schemaVersion: number;
  values: Record<string, BridgeValue>;
  refs: Record<string, unknown>;
  blobRefs: Array<{ blobId: string; size: number; mime: string | null }>;
}
export interface BridgeDeleteBody { table: string; pk: string }
export type BridgeBody = BridgeUpsertBody | BridgeDeleteBody;
/** A null nonce is reserved for the development pass-through codec. */
export interface BridgeEnvelope {
  header: BridgeHeader;
  body: { nonce: string | null; payload: string };
}
export interface BridgeLogRecord { seq: number; envelope: BridgeEnvelope }
export type BridgePushResult =
  | { seq: number }
  | { deleted: BridgeEnvelope }
  | { error: "notOwner" };
export type BridgeClientMessage =
  | { type: "hello"; label: string; platform: string }
  | { type: "push"; stream: BridgeStream; records: BridgeEnvelope[] }
  | { type: "pull"; stream: BridgeStream; after: number; limit: number }
  | { type: "subscribe"; streams: BridgeStream[] }
  | { type: "compact" };
export type BridgeServerMessage =
  | { type: "identified"; backendId: string }
  | { type: "ack"; stream: BridgeStream; results: BridgePushResult[] }
  | { type: "records"; stream: BridgeStream; records: BridgeLogRecord[]; next: number; hasMore: boolean }
  | { type: "subscribed"; streams: BridgeStream[] }
  | { type: "compacted" }
  | { type: "changed"; stream: BridgeStream }
  | { type: "presence"; backendId: string; online: boolean; lastSeen: string; label?: string; platform?: string };

export interface BridgeRpcRequest { requestId: string; message: BridgeClientMessage }
export type BridgeRpcResponse =
  | { requestId: string; message: BridgeServerMessage }
  | { requestId: string; error: { code: string; message: string } };
