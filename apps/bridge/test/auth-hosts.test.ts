import { describe, expect, it } from "vitest";
import { readFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CHANNELS } from "@mains/contracts/channels";
import { bridgeBase64, bridgeBytes, type BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import { applyBridgeMembershipEntry } from "@mains/contracts/bridge-membership";
import type { AtlasPage } from "@mains/contracts/atlas";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { startLocalBackends, waitFor } from "./local-backends";
import { approve, signIn } from "./auth-helpers";
import { bridgeAccountKeyCommitment, generateBridgeAccountKey, generateBridgeDeviceKeyPair, generateBridgeSigningKeyPair, sealBridgeAccountKey } from "../../../packages/backend/src/modules/bridge/bridge.keys";
import { deviceSigner, signBridgeMembershipEntry, verifyBridgeSignature } from "../../../packages/backend/src/modules/bridge/bridge.membership";
import { createNodeBackendRuntime } from "../../../packages/backend/src/runtime/node-backend-runtime";
import { createBridgeIdentityStorage } from "../../../packages/backend/src/modules/bridge/bridge.identity-storage";

type Fixture = Awaited<ReturnType<typeof startLocalBackends>>;
function cli(backend: Fixture["a"], args: string[], input = ""): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [fileURLToPath(new URL("../../server/.vite/server/server.cjs", import.meta.url)), "bridge", ...args,
      "--data-dir", backend.dir, "--server-url", backend.url, "--token", backend.token], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Bridge CLI failed: ${stderr}`)); else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

describe.skipIf(process.env.MAINS_BRIDGE_HOST_TESTS !== "1")("Bridge identity through real Better Auth, D1 and two backends", () => {
  it("survives a truncated renewal response, retries after process restart and continues two-device sync with the same key", async () => {
    const fixture = await startLocalBackends({ auth: true, truncateRefreshOnce: true }), { a, b } = fixture;
    try {
      const trusted = await signIn(fixture, a); await signIn(fixture, b); await approve(fixture);
      await a.stop(); // Edit only the stopped disposable profile, never a live database or user profile.
      // Keep peer presence from retrying the one-shot renewal fault before it is inspected.
      await b.stop();
      const storage = createNodeBackendRuntime({ dataDir: a.dir, appVersion: "test" }).secretStorage;
      const vault = createBridgeIdentityStorage(a.dir, storage), before = (await vault.read())!;
      await vault.write({ ...before, expiresAt: Date.now() + 86400_000 });
      await a.start();
      const failed = await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus),
        (value) => !!value.error?.includes("renewal response"), "truncated refresh response");
      expect(failed).toMatchObject({ state: "ready" });
      expect((await vault.read())!.token).toBe(before.token);
      expect((await vault.read())!.accountKey).toBe(before.accountKey);
      const proposed = (await vault.read())!.pendingToken;
      expect(proposed).toMatch(/^b7_[a-f0-9]{64}$/);
      await a.client.call(CHANNELS.bridge.syncNow); // The old credential still works.
      const db = await fixture.hub.database();
      const pending = await db.prepare("SELECT token_hash,next_token_hash FROM bridge_backends WHERE account_id=? AND backend_id=?").bind(trusted.accountId, a.backendId).first();
      expect(pending!.token_hash).toBe(createHash("sha256").update(before.token).digest("hex"));
      expect(pending!.next_token_hash).toBe(createHash("sha256").update(proposed!).digest("hex"));
      await a.stop(); await a.start();
      const renewed = await waitFor(() => vault.read(), (value) => !!value && value.token !== before.token, "durable replacement credential");
      expect(renewed!.token).toBe(proposed); expect(renewed!.pendingToken).toBeNull();
      await waitFor(() => db.prepare("SELECT next_token_hash FROM bridge_backends WHERE account_id=? AND backend_id=?").bind(trusted.accountId, a.backendId).first(),
        (value) => value?.next_token_hash === null, "committed handover");
      expect(renewed!.accountKey).toBe(before.accountKey);
      expect(await a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).toMatchObject({ state: "ready", error: null });
      await b.start();
      const page = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "After token handover", markdown: "No reapproval or new key" });
      await a.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => b.client.call<AtlasPage | null>(CHANNELS.atlas.get, { accountId: "default", id: page.item.id }),
        (value) => value?.revision.id === page.revision.id, "Page after recovered renewal");
    } finally { await fixture.dispose(); }
  }, 120_000);
  it("blocks a compromised hub's substituted wrap and forged account history before any replication starts", async () => {
    const fixture = await startLocalBackends({ auth: true }); const { a, b } = fixture;
    try {
      const trusted = await signIn(fixture, a);
      const page = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Trusted history", markdown: "The hub must never replace this account key" });
      await a.client.call(CHANNELS.bridge.syncNow);
      expect((await signIn(fixture, b)).state).toBe("needs-approval");
      const local = await b.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Keep private until verified", markdown: "A forged key must not upload this history" });
      const db = await fixture.hub.database();
      const row = await db.prepare("SELECT public_key,signing_public_key FROM bridge_backends WHERE account_id=? AND backend_id=?")
        .bind(trusted.accountId, b.backendId).first<{ public_key: string; signing_public_key: string }>();
      const fake = generateBridgeAccountKey(), attacker = generateBridgeSigningKeyPair();
      try {
        // Only the disposable hub is changed: simulate full hub compromise. It forges a whole
        // account history, internally consistent with its own key, and approves B in it.
        const forger = { backendId: "attacker", publicKey: bridgeBase64(generateBridgeDeviceKeyPair().publicKey), signingPublicKey: bridgeBase64(attacker.publicKey) };
        const genesis = signBridgeMembershipEntry({ accountId: trusted.accountId!, seq: -1, head: null }, { kind: "genesis", body: { member: forger,
          recoverySigningPublicKey: bridgeBase64(generateBridgeSigningKeyPair().publicKey), accountKeyCommitment: bridgeAccountKeyCommitment(fake) } }, deviceSigner(forger), attacker.secretKey);
        const add = signBridgeMembershipEntry(await applyBridgeMembershipEntry(null, genesis, verifyBridgeSignature), { kind: "add", body: {
          member: { backendId: b.backendId, publicKey: row!.public_key, signingPublicKey: row!.signing_public_key }, via: "approval" } }, deviceSigner(forger), attacker.secretKey);
        const forged = await applyBridgeMembershipEntry(await applyBridgeMembershipEntry(null, genesis, verifyBridgeSignature), add, verifyBridgeSignature);
        await fixture.hub.quotaSql(trusted.accountId!, `DELETE FROM membership; INSERT INTO membership(seq,hash,entry,appended_at) VALUES(0,'${forged.hashes[0]}','${JSON.stringify(genesis)}',${Date.now()}),(1,'${forged.hashes[1]}','${JSON.stringify(add)}',${Date.now()})`);
        const wrap = sealBridgeAccountKey(fake, bridgeBytes(row!.public_key, 32));
        await db.batch([
          db.prepare("UPDATE bridge_backends SET status='approved' WHERE account_id=? AND backend_id=?").bind(trusted.accountId, b.backendId),
          db.prepare("INSERT INTO bridge_key_wraps(account_id,backend_id,wrap) VALUES(?,?,?)").bind(trusted.accountId, b.backendId, JSON.stringify(wrap)),
        ]);
      } finally { fake.fill(0); }
      const offered = await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.state === "needs-verification", "untrusted candidate");
      expect(offered.joinCodes).toEqual([]);
      // A never approved B and refuses the forged history, so the trusted device shows no code for B.
      const trustedView = await a.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth);
      expect(trustedView.error).toMatch(/membership conflict/i); expect(trustedView.joinCodes).toEqual([]);
      // The hub refuses A, but the log it still serves proves a conflict, not a removal: A keeps its key.
      expect(trustedView.state).toBe("ready");
      const guess = "ABCD-EFGH-JKLM";
      expect(await b.client.invoke(CHANNELS.bridge.confirmAccountKey, guess)).toMatchObject({ success: false });
      expect(await b.client.invoke(CHANNELS.bridge.syncNow)).toMatchObject({ success: false });
      const phone = await b.pair();
      try {
        expect(await phone.invoke(CHANNELS.bridge.confirmAccountKey, guess)).toMatchObject({ success: false });
      } finally { phone.close(); }
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
      expect(await b.client.call(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).toBeNull();
      // The forged log omits A, so the hub refuses its sync too; A keeps its key and adopts nothing.
      expect(await a.client.invoke(CHANNELS.bridge.syncNow)).toMatchObject({ success: false });
      expect(await a.client.call(CHANNELS.atlas.get, { accountId: "default", id: local.item.id })).toBeNull();
      const stored = await fixture.hub.inspect(trusted.accountId!);
      expect(stored.filter((row) => {
        if (typeof row.envelope !== "string") throw new Error("Invalid test log envelope");
        return JSON.parse(row.envelope).header.origin === b.backendId;
      })).toHaveLength(0);
      await b.stop(); await b.start();
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("needs-verification");
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
    } finally { await fixture.dispose(); }
  }, 120_000);

  it("joins B only after A approves the matching public-key code, then persists keys and syncs", async () => {
    const fixture = await startLocalBackends({ auth: true }); const { a, b } = fixture;
    try {
      const owner = await signIn(fixture, a); expect(owner.state).toBe("ready");
      expect(await a.client.invoke(CHANNELS.bridge.signIn, { hubUrl: fixture.hub.url, includeExisting: true })).toMatchObject({ success: false });
      await a.client.call(CHANNELS.bridge.syncNow);
      expect(JSON.parse(await cli(a, ["status"])).state).toBe("ready");
      const recovery = await a.client.call<string>(CHANNELS.bridge.takeRecoveryCode); expect(recovery).toMatch(/^(?:[A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
      expect(await a.client.call(CHANNELS.bridge.takeRecoveryCode)).toBeNull();
      const page = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Approved sync", markdown: "Private content" });
      const pending = await signIn(fixture, b); expect(pending.state).toBe("needs-approval");
      expect(pending.verificationCode).toMatch(/^(?:[A-HJ-NP-Z2-9]{4}-){2}[A-HJ-NP-Z2-9]{4}$/);
      expect(await b.client.call(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).toBeNull();
      // Observe notifications only: an explicit HTTP refresh would conceal a
      // broken event path now that the ready fallback is five minutes.
      const approver = await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus), (value) => value.approvals.some((entry) => entry.backendId === b.backendId), "approval notification");
      const request = approver.approvals.find((entry) => entry.backendId === b.backendId)!;
      expect(request.code).toBe(pending.verificationCode);
      expect(await a.client.invoke(CHANNELS.bridge.approveBackend, { ...request, code: "WRONG1" })).toMatchObject({ success: false });
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth)).state).toBe("needs-approval");
      const approved = await cli(a, ["approve", b.backendId, "--code", request.code]);
      expect(approved).toContain("Backend approved");
      const joinCode = /Join code: ([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(approved)![1];
      const offered = await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.state === "needs-verification", "account key comparison");
      expect(offered.joinCodes).toEqual([]);
      expect(JSON.parse(await cli(b, ["status"])).joinCodes).toEqual([]);
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
      expect(await b.client.call(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).toBeNull();
      await b.stop(); await b.start();
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("needs-verification");
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
      const wrong = `${joinCode[0] === "A" ? "B" : "A"}${joinCode.slice(1)}`;
      expect(await b.client.invoke(CHANNELS.bridge.confirmAccountKey, wrong)).toMatchObject({ success: false });
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
      expect(await cli(b, ["confirm", "--code", joinCode])).toContain("Device verified");
      await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.state === "ready", "approved B");
      await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus),
        (value) => !value.joinCodes.some((entry) => entry.backendId === b.backendId), "completed join code removed on A", 5000);
      await waitFor(() => b.client.call<AtlasPage | null>(CHANNELS.atlas.get, { accountId: "default", id: page.item.id }), (value) => value?.revision.id === page.revision.id, "decrypted Page on B");
      const file = join(b.dir, "bridge", "identity.json"), stored = await readFile(file, "utf8");
      expect(stored).not.toContain("b7_"); expect(stored).not.toContain(recovery); expect(stored).not.toContain("privateKey");
      if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
      await b.stop(); await b.start();
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("ready");
      expect((await b.client.call<AtlasPage>(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).revision.markdown).toContain("Private content");
      await a.stop(); await a.start();
      expect((await a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).joinCodes).toEqual([]);
      await a.client.call(CHANNELS.bridge.revokeBackend, b.backendId);
      await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus), (value) => value.state === "revoked", "revocation notification");
      expect(await b.client.invoke(CHANNELS.bridge.syncNow)).toMatchObject({ success: false });
    } finally { await fixture.dispose(); }
  }, 120_000);

  it("updates a peer's self-disconnect without revoking a temporarily offline device", async () => {
    const fixture = await startLocalBackends({ auth: true }); const { a, b } = fixture;
    try {
      await signIn(fixture, a); await signIn(fixture, b); await approve(fixture);
      await waitFor(() => a.client.call<BridgeStatus>(CHANNELS.bridge.getStatus),
        (value) => value.backends.some((entry) => entry.backendId === b.backendId && entry.online === true), "B online on A");
      await b.stop();
      await waitFor(() => a.client.call<BridgeStatus>(CHANNELS.bridge.getStatus),
        (value) => value.backends.some((entry) => entry.backendId === b.backendId && entry.online === false), "B offline on A");
      expect((await a.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth)).backends.find((entry) => entry.backendId === b.backendId)?.status).toBe("approved");
      await b.start();
      await waitFor(() => a.client.call<BridgeStatus>(CHANNELS.bridge.getStatus),
        (value) => value.backends.some((entry) => entry.backendId === b.backendId && entry.online === true), "B reconnected on A");
      await b.client.call(CHANNELS.bridge.signOut);
      const updated = await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus),
        (value) => value.backends.some((entry) => entry.backendId === b.backendId && entry.status === "revoked"),
        "self-disconnect reflected on A without manual refresh", 5000);
      expect(updated.state).toBe("ready");
      expect(updated.joinCodes.some((entry) => entry.backendId === b.backendId)).toBe(false);
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("signed-out");
    } finally { await fixture.dispose(); }
  }, 120_000);
  it("keeps a new join code visible when the same backend enrolls again after an earlier connection", async () => {
    const fixture = await startLocalBackends({ auth: true }); const { a, b } = fixture;
    try {
      await signIn(fixture, a); await signIn(fixture, b); await approve(fixture);
      await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus),
        (value) => value.joinCodes.length === 0, "first verification completed");
      await b.client.call(CHANNELS.bridge.signOut);
      expect((await signIn(fixture, b)).state).toBe("needs-approval");
      const pending = await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus),
        (value) => value.approvals.some((entry) => entry.backendId === b.backendId), "new approval request");
      await a.client.call(CHANNELS.bridge.approveBackend, pending.approvals.find((entry) => entry.backendId === b.backendId));
      const join = (await a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).joinCodes.find((entry) => entry.backendId === b.backendId);
      expect(join?.code).toBeTruthy();
      await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth),
        (value) => value.state === "needs-verification", "new key awaiting verification");
      await b.client.call(CHANNELS.bridge.confirmAccountKey, join!.code);
      await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus),
        (value) => value.joinCodes.length === 0, "new verification completed");
    } finally { await fixture.dispose(); }
  }, 120_000);
  it("clears the approval request on online A when B joins with a recovery code", async () => {
    const fixture = await startLocalBackends({ auth: true }); const { a, b } = fixture;
    try {
      expect((await signIn(fixture, a)).state).toBe("ready");
      const recovery = await a.client.call<string>(CHANNELS.bridge.takeRecoveryCode);
      expect(recovery).toBeTruthy();
      expect((await signIn(fixture, b)).state).toBe("needs-approval");
      const pending = await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus),
        (value) => value.approvals.some((entry) => entry.backendId === b.backendId), "approval request on A");
      expect(pending.backends.find((entry) => entry.backendId === b.backendId)?.status).toBe("pending");
      await b.client.call(CHANNELS.bridge.enterRecoveryCode, recovery);
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("ready");
      const db = await fixture.hub.database();
      expect(await db.prepare(`SELECT b.status AS backend_status,r.status AS approval_status FROM bridge_backends b
        JOIN bridge_approvals r ON r.account_id=b.account_id AND r.backend_id=b.backend_id
        WHERE b.account_id=? AND b.backend_id=?`).bind(pending.accountId, b.backendId).first())
        .toEqual({ backend_status: "approved", approval_status: "approved" });
      const updated = await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus),
        (value) => !value.approvals.some((entry) => entry.backendId === b.backendId)
          && value.backends.some((entry) => entry.backendId === b.backendId && entry.status === "approved"),
        "recovery completion on A without manually refreshing or declining", 5000);
      expect(updated.state).toBe("ready");
      expect(updated.error).toBeNull();
    } finally { await fixture.dispose(); }
  }, 120_000);
  it("joins B with the recovery code while A is offline and rejects a wrong code", async () => {
    const fixture = await startLocalBackends({ auth: true }); const { a, b } = fixture;
    try {
      expect((await signIn(fixture, a)).state).toBe("ready");
      const previousRecovery = await a.client.call<string>(CHANNELS.bridge.regenerateRecoveryCode);
      expect(await a.client.call(CHANNELS.bridge.takeRecoveryCode)).toBeNull();
      expect((await a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).recoveryCodeAvailable).toBe(false);
      const recovery = await a.client.call<string>(CHANNELS.bridge.regenerateRecoveryCode);
      expect(recovery).not.toBe(previousRecovery);
      const page = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Recovery sync", markdown: "A may be offline" });
      await a.client.call(CHANNELS.bridge.syncNow); await a.stop();
      expect((await signIn(fixture, b)).state).toBe("needs-approval");
      expect(await b.client.invoke(CHANNELS.bridge.enterRecoveryCode, previousRecovery)).toMatchObject({ success: false });
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("needs-approval");
      expect(await cli(b, ["recover"], `${recovery}\n`)).toContain("Recovery complete");
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("ready");
      const received = await waitFor(() => b.client.call<AtlasPage | null>(CHANNELS.atlas.get, { accountId: "default", id: page.item.id }), (value) => value?.revision.id === page.revision.id, "recovered account on B");
      expect(received?.revision.markdown).toContain("A may be offline");
      await b.client.call(CHANNELS.bridge.signOut);
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("signed-out");
      await expect(access(join(b.dir, "bridge", "identity.json"))).rejects.toThrow();
      expect((await b.client.call<AtlasPage>(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).revision.id).toBe(page.revision.id);
      expect((await signIn(fixture, b)).state).toBe("needs-approval");
      await b.client.call(CHANNELS.bridge.enterRecoveryCode, recovery);
      await b.client.call(CHANNELS.bridge.syncNow);
      await b.client.call(CHANNELS.bridge.signOut, true);
      expect(await b.client.call(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).toBeNull();
    } finally { await fixture.dispose(); }
  }, 120_000);
});
