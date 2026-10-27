import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { bridgeBase64 } from "@mains/contracts/bridge-auth";
import { applyBridgeMembershipEntry, bridgeFenceRoot, bridgeMembershipEntryHash, bridgeMembershipSigningMessage, bridgeWriterKeyAt, currentBridgeMembers,
  validateBridgeFence, validateBridgeMembershipEntry, verifyBridgeMembershipLog, type BridgeMember, type BridgeMembershipChange, type BridgeMembershipEntry, type BridgeMembershipState } from "@mains/contracts/bridge-membership";
import { deviceSigner, signBridgeMembershipEntry, verifyBridgeSignature } from "./bridge.membership";
import { bridgeAccountKeyCommitment, bridgeJoinCode } from "./bridge.keys";

function device(backendId: string) {
  const encryption = x25519.keygen(), signing = ed25519.keygen();
  const member: BridgeMember = { backendId, publicKey: bridgeBase64(encryption.publicKey), signingPublicKey: bridgeBase64(signing.publicKey) };
  return { member, secret: signing.secretKey, signer: deviceSigner(member) };
}
const noRecords = { through: 0, count: 0, root: createHash("sha256").update("[]").digest("base64url") };
const recoveryKey = () => { const pair = ed25519.keygen(); return { publicKey: bridgeBase64(pair.publicKey), secret: pair.secretKey }; };
const accountKey = new Uint8Array(32).fill(7);
const apply = (state: BridgeMembershipState | null, entry: unknown) => applyBridgeMembershipEntry(state, entry, verifyBridgeSignature);
async function account() {
  const a = device("A"), recovery = recoveryKey();
  const genesis = signBridgeMembershipEntry({ accountId: "acct", seq: -1, head: null },
    { kind: "genesis", body: { member: a.member, recoverySigningPublicKey: recovery.publicKey, accountKeyCommitment: bridgeAccountKeyCommitment(accountKey) } }, a.signer, a.secret);
  const log: BridgeMembershipEntry[] = [genesis];
  let state = await apply(null, genesis);
  const append = async (change: BridgeMembershipChange, by: { signer: BridgeMembershipEntry["signer"]; secret: Uint8Array }) => {
    const entry = signBridgeMembershipEntry(state, change, by.signer, by.secret);
    state = await apply(state, entry); log.push(entry); return entry;
  };
  return { a, recovery, log, append, get state() { return state; } };
}

describe("Bridge membership log", () => {
  it("starts from a self-signed genesis whose recovery authority is independent of its member", async () => {
    const { a, state } = await account();
    expect(state).toMatchObject({ accountId: "acct", seq: 0, accountKeyCommitment: bridgeAccountKeyCommitment(accountKey) });
    expect(currentBridgeMembers(state)).toEqual([{ ...a.member, from: 0, until: null }]);
    const b = device("B");
    // Signed by a key that is not the genesis member's.
    await expect(apply(null, signBridgeMembershipEntry({ accountId: "acct", seq: -1, head: null },
      { kind: "genesis", body: { member: a.member, recoverySigningPublicKey: recoveryKey().publicKey, accountKeyCommitment: state.accountKeyCommitment } }, b.signer, b.secret))).rejects.toThrow(/not a current member/);
    await expect(apply(null, signBridgeMembershipEntry({ accountId: "acct", seq: -1, head: null },
      { kind: "genesis", body: { member: a.member, recoverySigningPublicKey: a.member.signingPublicKey, accountKeyCommitment: state.accountKeyCommitment } }, a.signer, a.secret))).rejects.toThrow(/independent/);
  });

  it("admits devices by member approval or by the recovery authority, and never a device's own say-so", async () => {
    const log = await account(), b = device("B"), c = device("C"), outsider = device("X");
    await log.append({ kind: "add", body: { member: b.member, via: "approval" } }, log.a);
    await log.append({ kind: "add", body: { member: c.member, via: "recovery" } }, { signer: { kind: "recovery", signingPublicKey: log.recovery.publicKey }, secret: log.recovery.secret });
    expect(currentBridgeMembers(log.state).map((m) => m.backendId)).toEqual(["A", "B", "C"]);
    const d = device("D");
    await expect(log.append({ kind: "add", body: { member: d.member, via: "approval" } }, outsider)).rejects.toThrow(/not a current member/);
    await expect(log.append({ kind: "add", body: { member: d.member, via: "approval" } }, d)).rejects.toThrow(/not a current member/);
    // A member cannot claim the recovery path, and the recovery authority cannot approve or remove.
    await expect(log.append({ kind: "add", body: { member: d.member, via: "recovery" } }, log.a)).rejects.toThrow(/not a current member/);
    const recovery = { signer: { kind: "recovery" as const, signingPublicKey: log.recovery.publicKey }, secret: log.recovery.secret };
    await expect(log.append({ kind: "add", body: { member: d.member, via: "approval" } }, recovery)).rejects.toThrow(/recovery authority/);
    await expect(log.append({ kind: "remove", body: { backendId: "B", account: noRecords } }, recovery)).rejects.toThrow(/recovery authority/);
  });

  it("rejects duplicate members and any reuse of a key, including by a re-added backend", async () => {
    const log = await account(), b = device("B");
    await log.append({ kind: "add", body: { member: b.member, via: "approval" } }, log.a);
    await expect(log.append({ kind: "add", body: { member: device("B").member, via: "approval" } }, log.a)).rejects.toThrow(/already a member/);
    await expect(log.append({ kind: "add", body: { member: { ...device("C").member, signingPublicKey: b.member.signingPublicKey }, via: "approval" } }, log.a)).rejects.toThrow(/reused/);
    await expect(log.append({ kind: "add", body: { member: { ...device("C").member, publicKey: log.a.member.publicKey }, via: "approval" } }, log.a)).rejects.toThrow(/reused/);
    await expect(log.append({ kind: "add", body: { member: { ...device("C").member, signingPublicKey: log.recovery.publicKey }, via: "approval" } }, log.a)).rejects.toThrow(/reused/);
    await log.append({ kind: "remove", body: { backendId: "B", account: noRecords } }, log.a);
    await expect(log.append({ kind: "add", body: { member: b.member, via: "approval" } }, log.a)).rejects.toThrow(/reused/);
    const again = device("B");
    await log.append({ kind: "add", body: { member: again.member, via: "approval" } }, log.a);
    expect(currentBridgeMembers(log.state).map((m) => m.signingPublicKey)).toEqual([log.a.member.signingPublicKey, again.member.signingPublicKey]);
  });

  it("lets any member remove any member, itself included, and a removed device sign nothing afterwards", async () => {
    const log = await account(), b = device("B"), c = device("C");
    for (const next of [b, c]) await log.append({ kind: "add", body: { member: next.member, via: "approval" } }, log.a);
    await log.append({ kind: "remove", body: { backendId: "A", account: noRecords } }, b);
    await expect(log.append({ kind: "add", body: { member: device("D").member, via: "approval" } }, log.a)).rejects.toThrow(/not a current member/);
    await log.append({ kind: "remove", body: { backendId: "C", account: noRecords } }, c);
    await expect(log.append({ kind: "remove", body: { backendId: "C", account: noRecords } }, b)).rejects.toThrow(/not a member/);
    expect(currentBridgeMembers(log.state).map((m) => m.backendId)).toEqual(["B"]);
  });

  it("answers which key a writer held at any head", async () => {
    const log = await account(), b = device("B");
    const added = await log.append({ kind: "add", body: { member: b.member, via: "approval" } }, log.a);
    const removed = await log.append({ kind: "remove", body: { backendId: "B", account: noRecords } }, log.a);
    const again = device("B"); await log.append({ kind: "add", body: { member: again.member, via: "approval" } }, log.a);
    const at = (key: string, seq: number) => bridgeWriterKeyAt(log.state, "B", key, seq);
    expect([at(b.member.signingPublicKey, added.seq - 1), at(b.member.signingPublicKey, added.seq), at(b.member.signingPublicKey, removed.seq)]).toEqual([false, true, false]);
    expect([at(again.member.signingPublicKey, removed.seq), at(again.member.signingPublicKey, log.state.seq), at(again.member.signingPublicKey, log.state.seq + 1)]).toEqual([false, true, false]);
  });

  it("rotates the recovery authority, after which the old one admits nothing", async () => {
    const log = await account(), next = recoveryKey();
    await expect(log.append({ kind: "recovery", body: { recoverySigningPublicKey: log.a.member.signingPublicKey } }, log.a)).rejects.toThrow(/independent/);
    await log.append({ kind: "recovery", body: { recoverySigningPublicKey: next.publicKey } }, log.a);
    const old = { signer: { kind: "recovery" as const, signingPublicKey: log.recovery.publicKey }, secret: log.recovery.secret };
    await expect(log.append({ kind: "add", body: { member: device("B").member, via: "recovery" } }, old)).rejects.toThrow(/recovery authority/);
    await log.append({ kind: "add", body: { member: device("B").member, via: "recovery" } }, { signer: { kind: "recovery", signingPublicKey: next.publicKey }, secret: next.secret });
  });

  it("verifies a whole log only as one unbroken, untampered chain containing the pinned head", async () => {
    const log = await account(), b = device("B");
    await log.append({ kind: "add", body: { member: b.member, via: "approval" } }, log.a);
    await log.append({ kind: "remove", body: { backendId: "B", account: noRecords } }, log.a);
    const verify = (entries: unknown[], anchor?: { seq: number; hash: string }) => verifyBridgeMembershipLog(entries, verifyBridgeSignature, anchor);
    expect((await verify(log.log, { seq: 1, hash: log.state.hashes[1] })).head).toBe(log.state.head);
    await expect(verify(log.log, { seq: 1, hash: log.state.hashes[2] })).rejects.toThrow(/pinned history/);
    await expect(verify([log.log[0], log.log[2]])).rejects.toThrow(/does not extend/);
    await expect(verify([log.log[1], log.log[0]])).rejects.toThrow(/start with genesis/);
    await expect(verify([log.log[0], { ...log.log[1], accountId: "other" }])).rejects.toThrow(/does not extend/);
    const tampered = structuredClone(log.log); (tampered[1] as Extract<BridgeMembershipEntry, { kind: "add" }>).body.member.publicKey = device("Z").member.publicKey;
    await expect(verify(tampered)).rejects.toThrow(/signature is invalid/);
    await expect(verify([])).rejects.toThrow(/empty/);
    await expect(verify([{ ...log.log[0], extra: true }])).rejects.toThrow(/Invalid/);
  });

  it("signs fixed positions, so property order cannot change an entry's meaning or hash", async () => {
    const { log } = await account(), entry = log[0] as Extract<BridgeMembershipEntry, { kind: "genesis" }>;
    const reordered = { signature: entry.signature, signer: { signingPublicKey: entry.signer.signingPublicKey, backendId: (entry.signer as { backendId: string }).backendId, kind: "device" },
      body: { accountKeyCommitment: entry.body.accountKeyCommitment, recoverySigningPublicKey: entry.body.recoverySigningPublicKey,
        member: { signingPublicKey: entry.body.member.signingPublicKey, publicKey: entry.body.member.publicKey, backendId: entry.body.member.backendId } },
      kind: entry.kind, prev: entry.prev, seq: entry.seq, accountId: entry.accountId, v: entry.v } as unknown as BridgeMembershipEntry;
    expect(bridgeMembershipSigningMessage(reordered)).toEqual(bridgeMembershipSigningMessage(entry));
    expect(await bridgeMembershipEntryHash(reordered)).toBe(await bridgeMembershipEntryHash(entry));
    expect(await bridgeMembershipEntryHash({ ...entry, signature: bridgeBase64(new Uint8Array(64)) })).not.toBe(await bridgeMembershipEntryHash(entry));
  });

  it("derives join codes bound to the admitting entry, account and backend", () => {
    const code = bridgeJoinCode(accountKey, "acct", "B", "h".repeat(43));
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    for (const other of [bridgeJoinCode(accountKey, "acct", "B", "i".repeat(43)), bridgeJoinCode(accountKey, "other", "B", "h".repeat(43)),
      bridgeJoinCode(accountKey, "acct", "C", "h".repeat(43)), bridgeJoinCode(new Uint8Array(32).fill(8), "acct", "B", "h".repeat(43))]) expect(other).not.toBe(code);
  });
  it("accepts a removal fence only as the exact sorted signature list its entry commits to", async () => {
    const signatures = [3, 4, 5].map((fill) => bridgeBase64(new Uint8Array(64).fill(fill))), fence = { through: 7, count: 3, root: await bridgeFenceRoot(signatures) };
    expect(await validateBridgeFence(signatures, fence)).toEqual(signatures);
    for (const wrong of [signatures.slice(1), [...signatures].reverse(), [signatures[0], signatures[0], signatures[2]], [...signatures.slice(0, 2), "x"], "not a list"])
      await expect(validateBridgeFence(wrong, fence)).rejects.toThrow();
    await expect(validateBridgeFence(signatures, { ...fence, root: await bridgeFenceRoot(signatures.slice(1)) })).rejects.toThrow(/does not match/);
    const log = await account(), removal = await log.append({ kind: "remove", body: { backendId: "A", account: fence } }, log.a);
    expect(bridgeMembershipSigningMessage(removal)).not.toEqual(bridgeMembershipSigningMessage({ ...removal, body: { ...removal.body, account: { ...fence, through: 8 } } } as BridgeMembershipEntry));
    expect(() => validateBridgeMembershipEntry({ ...removal, body: { backendId: "A" } })).toThrow(/removal/);
    expect(() => validateBridgeMembershipEntry({ ...removal, body: { backendId: "A", account: { ...fence, count: -1 } } })).toThrow(/removal/);
  });
  it("lets any member, never the recovery authority, append a horizon checkpoint that changes no keys", async () => {
    const log = await account(), keys = log.state.keys;
    const checkpoint = await log.append({ kind: "checkpoint", body: { horizon: true } }, log.a);
    expect(log.state).toMatchObject({ seq: 1, keys });
    expect(bridgeMembershipSigningMessage(checkpoint)).toEqual(new TextEncoder().encode(JSON.stringify([1, "mains.bridge.v1/membership", "acct", 1, checkpoint.prev, "checkpoint", [true], "device", "A", log.a.member.signingPublicKey])));
    const recovery = { signer: { kind: "recovery" as const, signingPublicKey: log.recovery.publicKey }, secret: log.recovery.secret };
    await expect(log.append({ kind: "checkpoint", body: { horizon: true } }, recovery)).rejects.toThrow(/recovery authority/);
    const outsider = device("X");
    await expect(log.append({ kind: "checkpoint", body: { horizon: true } }, outsider)).rejects.toThrow(/not a current member/);
    expect(() => validateBridgeMembershipEntry({ ...checkpoint, body: { horizon: false } })).toThrow(/checkpoint/);
  });
});
