import { ed25519 } from "@noble/curves/ed25519.js";
import { bridgeBase64, bridgeBytes } from "@mains/contracts/bridge-auth";
import { BRIDGE_FENCE_PAGE, bridgeFenceRoot, bridgeMembershipSigningMessage, extendBridgeMembership, validateBridgeFence, verifyBridgeMembershipLog,
  type BridgeAccountFence, type BridgeMember, type BridgeMembershipChange, type BridgeMembershipEntry, type BridgeMembershipSigner, type BridgeMembershipState,
  type BridgeSignatureVerifier, type BridgeUnsignedMembershipEntry } from "@mains/contracts/bridge-membership";
import type { BridgeLogRecord } from "@mains/contracts/bridge-protocol";
import { bridgeHttp } from "./bridge.login";
import { createBridgeWebSocketTransport } from "./bridge.websocket";

/** Strict RFC 8032 verification, matching record signatures. */
export const verifyBridgeSignature: BridgeSignatureVerifier = (signingPublicKey, message, signature) => {
  try { return ed25519.verify(bridgeBytes(signature, 64), message, bridgeBytes(signingPublicKey, 32), { zip215: false }); }
  catch { return false; }
};

/** Signs the next entry on `state` (or genesis when `state` is null). */
export function signBridgeMembershipEntry(state: Pick<BridgeMembershipState, "accountId" | "seq" | "head"> | { accountId: string; seq: -1; head: null },
  change: BridgeMembershipChange, signer: BridgeMembershipSigner, signingPrivateKey: Uint8Array): BridgeMembershipEntry {
  const unsigned = { v: 1 as const, accountId: state.accountId, seq: state.seq + 1, prev: state.head, ...change, signer } as BridgeUnsignedMembershipEntry;
  if (bridgeBase64(ed25519.getPublicKey(signingPrivateKey)) !== signer.signingPublicKey) throw new Error("Bridge membership signer does not match its key");
  return { ...unsigned, signature: bridgeBase64(ed25519.sign(bridgeMembershipSigningMessage(unsigned), signingPrivateKey)) } as BridgeMembershipEntry;
}
export const deviceSigner = (member: Pick<BridgeMember, "backendId" | "signingPublicKey">): BridgeMembershipSigner =>
  ({ kind: "device", backendId: member.backendId, signingPublicKey: member.signingPublicKey });

const MEMBERSHIP_PAGE = 1000;
/** The hub's entries after `after`, across pages, unverified until applied to a verified head. `appendedAt`
 * is the hub's time for its newest entry: an unauthenticated hint, used only to schedule heartbeats. */
export async function fetchBridgeMembership(hubUrl: string, token: string, after: number): Promise<{ entries: BridgeMembershipEntry[]; appendedAt: number | null }> {
  const entries: BridgeMembershipEntry[] = [];
  for (let cursor = after; ;) {
    const page = await bridgeHttp<{ entries: BridgeMembershipEntry[]; appendedAt?: unknown }>(hubUrl, `/v1/membership?after=${cursor}`, token);
    if (!Array.isArray(page?.entries) || page.entries.length > MEMBERSHIP_PAGE) throw new Error("Invalid Bridge membership response");
    entries.push(...page.entries); cursor += page.entries.length;
    if (page.entries.length < MEMBERSHIP_PAGE) return { entries, appendedAt: Number.isSafeInteger(page.appendedAt) ? page.appendedAt as number : null };
  }
}
export const bridgeMembershipConflict = (failure: unknown) =>
  new Error(`Bridge account membership conflict: ${failure instanceof Error ? failure.message : "invalid log"}`);

export interface BridgeRemovalFence { account: BridgeAccountFence; signatures: string[] }
/** What a removal admits: the removed writer's account records exactly as the remover's own full read
 * returns them, by signature (a writer can reuse a publication id, never a signature). */
export async function collectBridgeAccountFence(pull: (after: number) => Promise<{ records: BridgeLogRecord[]; next: number; hasMore: boolean }>,
  backendId: string): Promise<BridgeRemovalFence> {
  const signatures = new Set<string>();
  let through = 0;
  for (;;) {
    const page = await pull(through);
    for (const { envelope } of page.records) if (envelope.header.origin === backendId && typeof envelope.auth?.signature === "string") signatures.add(envelope.auth.signature);
    if (!Number.isSafeInteger(page.next) || page.next < through || page.hasMore && page.next === through) throw new Error("Invalid Bridge account read");
    through = page.next;
    if (!page.hasMore) break;
  }
  const sorted = [...signatures].sort();
  return { signatures: sorted, account: { through, count: sorted.length, root: await bridgeFenceRoot(sorted) } };
}
/** One full account read over a short-lived connection. */
export async function pullBridgeAccountFence(logUrl: string, token: string, backendId: string): Promise<BridgeRemovalFence> {
  const transport = createBridgeWebSocketTransport({ url: logUrl, token });
  try { return await collectBridgeAccountFence((after) => transport.pull("account", after, 1000), backendId); }
  finally { transport.close(); }
}
/** The hub's copy of a removal's list, accepted only if it is exactly what the signed entry commits to. */
export async function fetchBridgeFence(hubUrl: string, token: string, seq: number, fence: BridgeAccountFence): Promise<ReadonlySet<string>> {
  const signatures: string[] = [];
  for (let after = -1; ;) {
    const page = await bridgeHttp<{ signatures: string[] }>(hubUrl, `/v1/membership/fence?seq=${seq}&after=${after}`, token);
    if (!Array.isArray(page?.signatures) || page.signatures.length > BRIDGE_FENCE_PAGE) throw new Error("Invalid Bridge removal fence response");
    signatures.push(...page.signatures); after += page.signatures.length;
    if (page.signatures.length < BRIDGE_FENCE_PAGE || signatures.length > fence.count) break;
  }
  try { return new Set(await validateBridgeFence(signatures, fence)); }
  catch (failure) { throw bridgeMembershipConflict(failure); }
}

export interface BridgeVerifiedMembership { state: BridgeMembershipState; entries: BridgeMembershipEntry[] }
/** Replication's view of the verified log. The signing codec reads it synchronously; it advances only by
 * verified extensions of its own head, so the hub can neither rewind nor fork it. */
export interface BridgeMembershipView {
  /** Null until every removal in the state has its fence loaded. */
  current(): BridgeMembershipState | null;
  /** The signatures of the removed writer's account records that the removal at `seq` admits. */
  fence(seq: number): ReadonlySet<string> | undefined;
  /** Pulls and verifies the hub's newer entries and their fences; concurrent callers share one refresh. */
  refresh(): Promise<BridgeMembershipState>;
  /** The hub's time for its newest entry at the last refresh; a hint, never verified. */
  headAppendedAt(): number | null;
}
export function createBridgeMembershipView(options: {
  hubUrl: string; token: () => Promise<string>; accountId: string; accountKeyCommitment: string;
  /** A history already verified from a pinned head; without one, the hub's log is verified from genesis. */
  initial?: BridgeVerifiedMembership;
  /** Each verified extension, for the caller to persist; never awaited. */
  extended?: (membership: BridgeVerifiedMembership) => void;
}): BridgeMembershipView {
  let verified = options.initial ?? null, loaded = false, running: Promise<BridgeMembershipState> | undefined, appendedAt: number | null = null;
  const fences = new Map<number, ReadonlySet<string>>();
  async function loadFences(entries: readonly BridgeMembershipEntry[], token: string) {
    for (const entry of entries) if (entry.kind === "remove" && !fences.has(entry.seq))
      fences.set(entry.seq, await fetchBridgeFence(options.hubUrl, token, entry.seq, entry.body.account));
  }
  async function load(): Promise<BridgeMembershipState> {
    const token = await options.token();
    const { entries: more, appendedAt: newest } = await fetchBridgeMembership(options.hubUrl, token, verified?.state.seq ?? -1);
    appendedAt = newest;
    if (verified && !more.length) {
      if (!loaded) { await loadFences(verified.entries, token); loaded = true; }
      return verified.state;
    }
    let state: BridgeMembershipState;
    try {
      state = verified ? await extendBridgeMembership(verified.state, more, verifyBridgeSignature) : await verifyBridgeMembershipLog(more, verifyBridgeSignature);
      if (state.accountId !== options.accountId || state.accountKeyCommitment !== options.accountKeyCommitment) throw new Error("the log belongs to another account key");
    } catch (failure) { throw bridgeMembershipConflict(failure); }
    const next = { state, entries: [...verified?.entries ?? [], ...more] };
    // A removal becomes visible to the codec only together with what it admits.
    await loadFences(next.entries, token);
    verified = next; loaded = true;
    options.extended?.(verified);
    return state;
  }
  return {
    current: () => loaded ? verified?.state ?? null : null,
    fence: (seq) => fences.get(seq),
    headAppendedAt: () => appendedAt,
    refresh() { return running ??= load().finally(() => { running = undefined; }); },
  };
}
