import { bridgeBytes } from "@mains/contracts/bridge-auth";
import { applyBridgeMembershipEntry, bridgeMember, bridgeMembershipEntryHash, BRIDGE_FENCE_PAGE, BRIDGE_REPLAY_HORIZON_MS, validateBridgeFence, validateBridgeMembershipEntry,
  type BridgeMember, type BridgeMembershipHead, type BridgeMembershipState, type BridgeSignatureVerifier } from "@mains/contracts/bridge-membership";

export const verifyEd25519: BridgeSignatureVerifier = async (signingPublicKey, message, signature) => {
  try {
    const key = await crypto.subtle.importKey("raw", bridgeBytes(signingPublicKey, 32), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, bridgeBytes(signature, 64), message);
  } catch { return false; }
};
export type MembershipAppend =
  | { status: "appended" | "present"; head: BridgeMembershipHead }
  | { status: "conflict"; head: BridgeMembershipHead | null }
  | { status: "invalid"; error: string };
export const MEMBERSHIP_PAGE = 1000;
export const sameMember = (a: BridgeMember | undefined, b: BridgeMember) =>
  !!a && a.backendId === b.backendId && a.publicKey === b.publicKey && a.signingPublicKey === b.signingPublicKey;
export const currentMember = (state: BridgeMembershipState | null, backendId: string) => state ? bridgeMember(state, backendId) : undefined;

/** The hub stores and orders the account's membership log; only signed, authorized entries extend it.
 * Clients verify the same rules independently and never rely on this check. */
export function createHubMembership(storage: DurableObjectStorage) {
  const sql = storage.sql;
  // A removal also queues the revocation of the registration holding the removed keys; the removing
  // request revokes it in D1 right after, and the hub finishes one interrupted in between.
  sql.exec(`CREATE TABLE IF NOT EXISTS membership(seq INTEGER PRIMARY KEY,hash TEXT NOT NULL,entry TEXT NOT NULL,appended_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS membership_fences(entry_seq INTEGER NOT NULL,ordinal INTEGER NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(entry_seq,ordinal));
    CREATE TABLE IF NOT EXISTS membership_revocations(backend_id TEXT NOT NULL,signing_public_key TEXT NOT NULL,PRIMARY KEY(backend_id,signing_public_key));`);
  let cached: BridgeMembershipState | null | undefined;
  async function state(): Promise<BridgeMembershipState | null> {
    // A maintenance reset or restore can replace the rows under a live object.
    const top = Number(sql.exec("SELECT coalesce(max(seq),-1) AS n FROM membership").one().n);
    if (cached !== undefined && (cached?.seq ?? -1) === top) return cached;
    let next: BridgeMembershipState | null = null;
    for (const row of sql.exec<{ entry: string }>("SELECT entry FROM membership ORDER BY seq").toArray())
      next = await applyBridgeMembershipEntry(next, JSON.parse(row.entry), verifyEd25519);
    return cached = next;
  }
  return {
    state,
    /** Entries after `after`, and the hub time its newest entry was appended (a hint for heartbeats). */
    pull(after: number): { entries: unknown[]; appendedAt: number | null } {
      const entries = sql.exec<{ entry: string }>("SELECT entry FROM membership WHERE seq>? ORDER BY seq LIMIT ?", after, MEMBERSHIP_PAGE).toArray().map((row): unknown => JSON.parse(row.entry));
      const head = sql.exec<{ appended_at: number }>("SELECT appended_at FROM membership ORDER BY seq DESC LIMIT 1").toArray()[0];
      return { entries, appendedAt: head?.appended_at ?? null };
    },
    /** The replay horizon: the newest entry appended at least BRIDGE_REPLAY_HORIZON_MS ago (0 before any). */
    horizon(now = Date.now()): number {
      return Number(sql.exec("SELECT coalesce(max(seq),0) AS seq FROM membership WHERE appended_at<=?", now - BRIDGE_REPLAY_HORIZON_MS).one().seq);
    },
    /** When the horizon next moves on, if a newer entry exists. */
    nextHorizonAt(now = Date.now()): number | null {
      const next = sql.exec<{ at: number | null }>("SELECT min(appended_at) AS at FROM membership WHERE appended_at>?", now - BRIDGE_REPLAY_HORIZON_MS).one().at;
      return next === null ? null : next + BRIDGE_REPLAY_HORIZON_MS;
    },
    /** A removal's sorted signature list, after `after` (an ordinal). */
    fence(seq: number, after: number): string[] {
      return sql.exec<{ signature: string }>("SELECT signature FROM membership_fences WHERE entry_seq=? AND ordinal>? ORDER BY ordinal LIMIT ?", seq, after, BRIDGE_FENCE_PAGE)
        .toArray().map((row) => row.signature);
    },
    /** Removed keys whose registration D1 has not yet been confirmed to revoke. */
    revocations(): { backendId: string; signingPublicKey: string }[] {
      return sql.exec<{ backend_id: string; signing_public_key: string }>("SELECT backend_id,signing_public_key FROM membership_revocations ORDER BY backend_id")
        .toArray().map((row) => ({ backendId: row.backend_id, signingPublicKey: row.signing_public_key }));
    },
    revocationFinished(key: { backendId: string; signingPublicKey: string }) {
      sql.exec("DELETE FROM membership_revocations WHERE backend_id=? AND signing_public_key=?", key.backendId, key.signingPublicKey);
    },
    /** The caller holds the account gate: appends are compare-and-swap on the head. A removal is stored
     * together with the signature list its entry commits to. */
    async append(value: unknown, fence?: unknown): Promise<MembershipAppend> {
      try {
        validateBridgeMembershipEntry(value);
        if (value.kind === "remove") await validateBridgeFence(fence, value.body.account);
        else if (fence !== undefined) throw new Error("Only a removal carries a fence");
      } catch (error) { return { status: "invalid", error: error instanceof Error ? error.message : "Invalid Bridge membership entry" }; }
      const current = await state(), head = current ? { seq: current.seq, hash: current.head } : null;
      if (current && value.seq <= current.seq) {
        // A retry after a lost response finds its own entry; anything else lost the race.
        const existing = sql.exec<{ hash: string }>("SELECT hash FROM membership WHERE seq=?", value.seq).toArray()[0];
        return existing?.hash === await bridgeMembershipEntryHash(value) ? { status: "present", head: head! } : { status: "conflict", head };
      }
      if (value.seq !== (current?.seq ?? -1) + 1 || value.prev !== (current?.head ?? null)) return { status: "conflict", head };
      let next: BridgeMembershipState;
      try { next = await applyBridgeMembershipEntry(current, value, verifyEd25519); }
      catch (error) { return { status: "invalid", error: error instanceof Error ? error.message : "Invalid Bridge membership entry" }; }
      const removed = value.kind === "remove" ? bridgeMember(current!, value.body.backendId)! : null;
      storage.transactionSync(() => {
        sql.exec("INSERT INTO membership(seq,hash,entry,appended_at) VALUES(?,?,?,?)", next.seq, next.head, JSON.stringify(value), Date.now());
        if (value.kind === "remove") for (const [ordinal, signature] of (fence as string[]).entries())
          sql.exec("INSERT INTO membership_fences(entry_seq,ordinal,signature) VALUES(?,?,?)", next.seq, ordinal, signature);
        if (removed) sql.exec("INSERT OR IGNORE INTO membership_revocations(backend_id,signing_public_key) VALUES(?,?)", removed.backendId, removed.signingPublicKey);
      });
      cached = next;
      return { status: "appended", head: { seq: next.seq, hash: next.head } };
    },
  };
}
