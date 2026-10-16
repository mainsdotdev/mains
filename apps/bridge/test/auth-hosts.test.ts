import { describe, expect, it } from "vitest";
import { readFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CHANNELS } from "@mains/contracts/channels";
import { bridgeBytes, type BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import type { AtlasPage } from "@mains/contracts/atlas";
import { startLocalBackends, waitFor } from "./local-backends";
import { signIn } from "./auth-helpers";
import { generateBridgeAccountKey, sealBridgeAccountKey } from "../../../packages/backend/src/modules/bridge/bridge.keys";
import { bridgeRecoveryPublicKey } from "../../../packages/backend/src/modules/bridge/bridge.recovery";

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
  it("blocks a compromised hub's substituted wrap and verifier before any replication starts", async () => {
    const fixture = await startLocalBackends({ auth: true }); const { a, b } = fixture;
    try {
      const trusted = await signIn(fixture, a);
      const page = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Trusted history", markdown: "The hub must never replace this account key" });
      await a.client.call(CHANNELS.bridge.syncNow);
      expect((await signIn(fixture, b)).state).toBe("needs-approval");
      const local = await b.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Keep private until verified", markdown: "A forged key must not upload this history" });
      const db = await fixture.hub.database();
      const row = await db.prepare("SELECT public_key FROM bridge_backends WHERE account_id=? AND backend_id=?")
        .bind(trusted.accountId, b.backendId).first<{ public_key: string }>();
      const fake = generateBridgeAccountKey();
      try {
        // Only the disposable hub's D1 is changed: simulate full hub compromise,
        // including replacing both values that the old activation check trusted.
        const wrap = sealBridgeAccountKey(fake, bridgeBytes(row!.public_key, 32));
        await db.batch([
          db.prepare("UPDATE bridge_accounts SET recovery_public_key=? WHERE account_id=?").bind(bridgeRecoveryPublicKey(fake), trusted.accountId),
          db.prepare("UPDATE bridge_backends SET status='approved' WHERE account_id=? AND backend_id=?").bind(trusted.accountId, b.backendId),
          db.prepare("INSERT INTO bridge_key_wraps(account_id,backend_id,wrap) VALUES(?,?,?)").bind(trusted.accountId, b.backendId, JSON.stringify(wrap)),
        ]);
      } finally { fake.fill(0); }
      const offered = await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.state === "needs-verification", "untrusted candidate");
      expect(offered.accountFingerprint).toBeNull();
      expect((await a.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth)).accountFingerprint).toBe(trusted.accountFingerprint);
      expect(await b.client.invoke(CHANNELS.bridge.confirmAccountKey, trusted.accountFingerprint)).toMatchObject({ success: false });
      expect(await b.client.invoke(CHANNELS.bridge.syncNow)).toMatchObject({ success: false });
      const phone = await b.pair();
      try {
        expect(await phone.invoke(CHANNELS.bridge.confirmAccountKey, trusted.accountFingerprint)).toMatchObject({ success: false });
      } finally { phone.close(); }
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
      expect(await b.client.call(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).toBeNull();
      await a.client.call(CHANNELS.bridge.syncNow);
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
      const approver = await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.approvals.some((entry) => entry.backendId === b.backendId), "approval request");
      const request = approver.approvals.find((entry) => entry.backendId === b.backendId)!;
      expect(request.code).toBe(pending.verificationCode);
      expect(await a.client.invoke(CHANNELS.bridge.approveBackend, { ...request, code: "WRONG1" })).toMatchObject({ success: false });
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth)).state).toBe("needs-approval");
      expect(await cli(a, ["approve", b.backendId, "--code", request.code])).toContain("Backend approved");
      const offered = await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.state === "needs-verification", "account key comparison");
      expect(offered.accountFingerprint).toBeNull();
      expect(JSON.parse(await cli(b, ["status"])).accountFingerprint).toBeNull();
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
      expect(await b.client.call(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).toBeNull();
      await b.stop(); await b.start();
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("needs-verification");
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
      const wrong = `${owner.accountFingerprint![0] === "A" ? "B" : "A"}${owner.accountFingerprint!.slice(1)}`;
      expect(await b.client.invoke(CHANNELS.bridge.confirmAccountKey, wrong)).toMatchObject({ success: false });
      expect((await b.client.call(CHANNELS.bridge.getStatus)).enabled).toBe(false);
      expect(await cli(b, ["confirm", "--code", owner.accountFingerprint!])).toContain("Account key verified");
      await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.state === "ready", "approved B");
      await waitFor(() => b.client.call<AtlasPage | null>(CHANNELS.atlas.get, { accountId: "default", id: page.item.id }), (value) => value?.revision.id === page.revision.id, "decrypted Page on B");
      const file = join(b.dir, "bridge", "identity.json"), stored = await readFile(file, "utf8");
      expect(stored).not.toContain("b7_"); expect(stored).not.toContain(recovery); expect(stored).not.toContain("privateKey");
      if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
      await b.stop(); await b.start();
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("ready");
      expect((await b.client.call<AtlasPage>(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).revision.markdown).toContain("Private content");
      await a.client.call(CHANNELS.bridge.revokeBackend, b.backendId);
      await waitFor(() => b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.state === "revoked", "immediate revocation");
      expect(await b.client.invoke(CHANNELS.bridge.syncNow)).toMatchObject({ success: false });
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
