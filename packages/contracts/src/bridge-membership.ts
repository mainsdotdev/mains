import { bridgeBase64, bridgeBytes } from "./bridge-auth";

/** Stage 3 account membership: one signed, hash-chained log per account (apps/bridge/MEMBERSHIP.md).
 * Hub and backends share these rules; each supplies its own Ed25519 verifier. */
export interface BridgeMember { backendId: string; publicKey: string; signingPublicKey: string }
export type BridgeMembershipSigner =
  | { kind: "device"; backendId: string; signingPublicKey: string }
  | { kind: "recovery"; signingPublicKey: string };
export type BridgeMembershipChange =
  | { kind: "genesis"; body: { member: BridgeMember; recoverySigningPublicKey: string; accountKeyCommitment: string } }
  | { kind: "add"; body: { member: BridgeMember; via: "approval" | "recovery" } }
  | { kind: "remove"; body: { backendId: string; account: BridgeAccountFence } }
  | { kind: "recovery"; body: { recoverySigningPublicKey: string } }
  /** Moves the replay horizon on when membership is otherwise quiet (MEMBERSHIP.md §8). */
  | { kind: "checkpoint"; body: { horizon: true } };
export type BridgeMembershipEntry = BridgeMembershipChange & {
  v: 1; accountId: string; seq: number; prev: string | null; signer: BridgeMembershipSigner; signature: string;
};
type Unsigned<T> = T extends unknown ? Omit<T, "signature"> : never;
export type BridgeUnsignedMembershipEntry = Unsigned<BridgeMembershipEntry>;
/** One signing key's validity: from the entry that added it until the entry that removed it. */
export interface BridgeMemberKey extends BridgeMember { from: number; until: number | null }
export interface BridgeMembershipState {
  accountId: string;
  seq: number;
  head: string;
  accountKeyCommitment: string;
  recoverySigningPublicKey: string;
  /** Every key interval in log order; current members have `until: null`. */
  keys: BridgeMemberKey[];
  /** `hashes[seq]` is the hash of the entry at `seq`, for fork checks against bound heads. */
  hashes: string[];
}
/** What a removal admits of the removed writer's account stream: exactly the records whose signatures
 * the remover saw (apps/bridge/MEMBERSHIP.md §6). The hub derives the sorted list from the records it
 * stores, accepts the removal only if the list matches, and serves it beside the entry. */
export interface BridgeAccountFence { through: number; count: number; root: string }
export const BRIDGE_FENCE_PAGE = 1000;
/** The hub refuses publications bound below the newest membership entry at least this old, and drops
 * their replay receipts (MEMBERSHIP.md §8). */
export const BRIDGE_REPLAY_HORIZON_MS = 30 * 86_400_000;
/** A member appends a horizon checkpoint once the newest entry is this old, so the horizon keeps moving. */
export const BRIDGE_MEMBERSHIP_HEARTBEAT_MS = 7 * 86_400_000;
export type BridgeSignatureVerifier = (signingPublicKey: string, message: Uint8Array, signature: string) => boolean | Promise<boolean>;
export interface BridgeMembershipHead { seq: number; hash: string }

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const keys = (value: unknown, allowed: string[]): value is Record<string, any> =>
  object(value) && Object.keys(value).length === allowed.length && allowed.every((key) => key in value);
function key32(value: unknown): asserts value is string { bridgeBytes(value, 32); }
function validateMember(value: unknown): asserts value is BridgeMember {
  if (!keys(value, ["backendId", "publicKey", "signingPublicKey"]) || !identifier(value.backendId)) throw new Error("Invalid Bridge member");
  key32(value.publicKey); key32(value.signingPublicKey);
  if (value.publicKey === value.signingPublicKey) throw new Error("Invalid Bridge member");
}

export function validateBridgeMembershipEntry(value: unknown): asserts value is BridgeMembershipEntry {
  if (!keys(value, ["v", "accountId", "seq", "prev", "kind", "body", "signer", "signature"]) || value.v !== 1 || !identifier(value.accountId) ||
      !Number.isSafeInteger(value.seq) || value.seq < 0 || (value.seq === 0) !== (value.prev === null) || (value.seq === 0) !== (value.kind === "genesis"))
    throw new Error("Invalid Bridge membership entry");
  if (value.prev !== null) key32(value.prev);
  bridgeBytes(value.signature, 64);
  const signer = value.signer;
  if (signer?.kind === "device") { if (!keys(signer, ["kind", "backendId", "signingPublicKey"]) || !identifier(signer.backendId)) throw new Error("Invalid Bridge membership signer"); }
  else if (signer?.kind !== "recovery" || !keys(signer, ["kind", "signingPublicKey"])) throw new Error("Invalid Bridge membership signer");
  key32(signer.signingPublicKey);
  const body = value.body;
  switch (value.kind) {
    case "genesis":
      if (!keys(body, ["member", "recoverySigningPublicKey", "accountKeyCommitment"])) throw new Error("Invalid Bridge membership genesis");
      validateMember(body.member); key32(body.recoverySigningPublicKey); key32(body.accountKeyCommitment); break;
    case "add":
      if (!keys(body, ["member", "via"]) || body.via !== "approval" && body.via !== "recovery") throw new Error("Invalid Bridge membership addition");
      validateMember(body.member); break;
    case "remove":
      if (!keys(body, ["backendId", "account"]) || !identifier(body.backendId) || !keys(body.account, ["through", "count", "root"]) ||
          !Number.isSafeInteger(body.account.through) || body.account.through < 0 || !Number.isSafeInteger(body.account.count) ||
          body.account.count < 0) throw new Error("Invalid Bridge membership removal");
      key32(body.account.root); break;
    case "recovery":
      if (!keys(body, ["recoverySigningPublicKey"])) throw new Error("Invalid Bridge recovery authority"); key32(body.recoverySigningPublicKey); break;
    case "checkpoint":
      if (!keys(body, ["horizon"]) || body.horizon !== true) throw new Error("Invalid Bridge membership checkpoint"); break;
    default: throw new Error("Unknown Bridge membership entry");
  }
}

/** Fixed positions, independent of JSON property order. */
function bodyFields(entry: BridgeMembershipChange): unknown[] {
  const member = (m: BridgeMember) => [m.backendId, m.publicKey, m.signingPublicKey];
  switch (entry.kind) {
    case "genesis": return [...member(entry.body.member), entry.body.recoverySigningPublicKey, entry.body.accountKeyCommitment];
    case "add": return [...member(entry.body.member), entry.body.via];
    case "remove": return [entry.body.backendId, entry.body.account.through, entry.body.account.count, entry.body.account.root];
    case "recovery": return [entry.body.recoverySigningPublicKey];
    case "checkpoint": return [entry.body.horizon];
  }
}
function signingFields(entry: BridgeUnsignedMembershipEntry): unknown[] {
  return [1, "mains.bridge.v1/membership", entry.accountId, entry.seq, entry.prev, entry.kind, bodyFields(entry),
    entry.signer.kind, entry.signer.kind === "device" ? entry.signer.backendId : null, entry.signer.signingPublicKey];
}
export function bridgeMembershipSigningMessage(entry: BridgeUnsignedMembershipEntry): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(signingFields(entry)));
}
/** Commits to the exact signed bytes, so a chain identifies one history. */
export async function bridgeMembershipEntryHash(entry: BridgeMembershipEntry): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([...signingFields(entry), entry.signature]));
  return bridgeBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/** Commits to a fence's exact, sorted signature list. */
export async function bridgeFenceRoot(signatures: readonly string[]): Promise<string> {
  return bridgeBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(signatures)))));
}
/** Throws unless `signatures` is the strictly sorted list `fence` commits to. */
export async function validateBridgeFence(signatures: unknown, fence: BridgeAccountFence): Promise<string[]> {
  if (!Array.isArray(signatures) || signatures.length !== fence.count) throw new Error("Bridge removal fence does not match its entry");
  for (const [index, signature] of signatures.entries()) {
    bridgeBytes(signature, 64);
    if (index && signatures[index - 1] >= signature) throw new Error("Bridge removal fence must be sorted and unique");
  }
  if (await bridgeFenceRoot(signatures) !== fence.root) throw new Error("Bridge removal fence does not match its entry");
  return signatures;
}

export const currentBridgeMembers = (state: BridgeMembershipState) => state.keys.filter((entry) => entry.until === null);
export const bridgeMember = (state: BridgeMembershipState, backendId: string) => currentBridgeMembers(state).find((entry) => entry.backendId === backendId);
/** The interval in which `signingPublicKey` was `backendId`'s key at `seq`, if it was. */
export function bridgeWriterKey(state: BridgeMembershipState, backendId: string, signingPublicKey: string, seq: number): BridgeMemberKey | undefined {
  return seq <= state.seq ? state.keys.find((entry) => entry.backendId === backendId && entry.signingPublicKey === signingPublicKey &&
    entry.from <= seq && (entry.until === null || seq < entry.until)) : undefined;
}
/** Whether `signingPublicKey` was `backendId`'s key in the membership state at `seq`. */
export function bridgeWriterKeyAt(state: BridgeMembershipState, backendId: string, signingPublicKey: string, seq: number): boolean {
  return !!bridgeWriterKey(state, backendId, signingPublicKey, seq);
}

/** Applies one entry. Throws, leaving `state` untouched, unless the entry extends it and is authorized. */
export async function applyBridgeMembershipEntry(state: BridgeMembershipState | null, value: unknown, verify: BridgeSignatureVerifier): Promise<BridgeMembershipState> {
  validateBridgeMembershipEntry(value);
  const entry = value, signer = entry.signer;
  const reject = (message: string): never => { throw new Error(`Bridge membership entry ${entry.seq} rejected: ${message}`); };
  if (!state) {
    if (entry.kind !== "genesis") reject("the log must start with genesis");
  } else if (entry.kind === "genesis" || entry.accountId !== state.accountId || entry.seq !== state.seq + 1 || entry.prev !== state.head) reject("it does not extend the verified head");
  if (signer.kind === "device") {
    const authorized = entry.kind === "genesis"
      ? signer.backendId === entry.body.member.backendId && signer.signingPublicKey === entry.body.member.signingPublicKey
      : bridgeMember(state!, signer.backendId)?.signingPublicKey === signer.signingPublicKey && !(entry.kind === "add" && entry.body.via !== "approval");
    if (!authorized) reject("its device signer is not a current member");
  } else if (!state || entry.kind !== "add" || entry.body.via !== "recovery" || signer.signingPublicKey !== state.recoverySigningPublicKey) reject("the recovery authority may only add a device");
  if (!await verify(signer.signingPublicKey, bridgeMembershipSigningMessage(entry), entry.signature)) reject("its signature is invalid");
  const hash = await bridgeMembershipEntryHash(entry);
  if (entry.kind === "genesis") {
    const { member, recoverySigningPublicKey, accountKeyCommitment } = entry.body;
    if (recoverySigningPublicKey === member.signingPublicKey) reject("the recovery authority must be independent");
    return { accountId: entry.accountId, seq: 0, head: hash, accountKeyCommitment, recoverySigningPublicKey, keys: [{ ...member, from: 0, until: null }], hashes: [hash] };
  }
  const next: BridgeMembershipState = { ...state!, seq: entry.seq, head: hash, keys: state!.keys.map((key) => ({ ...key })), hashes: [...state!.hashes, hash] };
  if (entry.kind === "add") {
    const { member } = entry.body, used = new Set(next.keys.flatMap((key) => [key.publicKey, key.signingPublicKey]).concat(next.recoverySigningPublicKey));
    if (bridgeMember(next, member.backendId)) reject("the backend is already a member");
    if (used.has(member.publicKey) || used.has(member.signingPublicKey)) reject("a member key cannot be reused");
    next.keys.push({ ...member, from: entry.seq, until: null });
  } else if (entry.kind === "remove") {
    const current = next.keys.find((key) => key.backendId === entry.body.backendId && key.until === null);
    if (!current) reject("the backend is not a member");
    current!.until = entry.seq;
  } else if (entry.kind === "recovery") {
    const { recoverySigningPublicKey } = entry.body;
    if (recoverySigningPublicKey === next.recoverySigningPublicKey || next.keys.some((key) => key.signingPublicKey === recoverySigningPublicKey))
      reject("the recovery authority must be new and independent");
    next.recoverySigningPublicKey = recoverySigningPublicKey;
  }
  return next;
}

/** Verifies a whole log from genesis. `anchor` is the head this device pinned during an authenticated
 * ceremony; a log that does not contain it is a different history. */
export async function verifyBridgeMembershipLog(entries: readonly unknown[], verify: BridgeSignatureVerifier, anchor?: BridgeMembershipHead): Promise<BridgeMembershipState> {
  let state: BridgeMembershipState | null = null;
  for (const entry of entries) state = await applyBridgeMembershipEntry(state, entry, verify);
  if (!state) throw new Error("Bridge membership log is empty");
  if (anchor && state.hashes[anchor.seq] !== anchor.hash) throw new Error("Bridge membership log does not contain this device's pinned history");
  return state;
}
/** Extends verified local state with entries after its head. */
export async function extendBridgeMembership(state: BridgeMembershipState, entries: readonly unknown[], verify: BridgeSignatureVerifier): Promise<BridgeMembershipState> {
  let next = state;
  for (const entry of entries) next = await applyBridgeMembershipEntry(next, entry, verify);
  return next;
}
