import { describe, expect, it } from "vitest";
import { readFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CHANNELS } from "@mains/contracts/channels";
import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import type { AtlasPage } from "@mains/contracts/atlas";
import { startLocalBackends, waitFor } from "./local-backends";
import { signIn } from "./auth-helpers";

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
      expect(pending.verificationCode).toHaveLength(6);
      expect(await b.client.call(CHANNELS.atlas.get, { accountId: "default", id: page.item.id })).toBeNull();
      const approver = await waitFor(() => a.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth), (value) => value.approvals.some((entry) => entry.backendId === b.backendId), "approval request");
      const request = approver.approvals.find((entry) => entry.backendId === b.backendId)!;
      expect(request.code).toBe(pending.verificationCode);
      expect(await a.client.invoke(CHANNELS.bridge.approveBackend, { ...request, code: "WRONG1" })).toMatchObject({ success: false });
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.refreshAuth)).state).toBe("needs-approval");
      expect(await cli(a, ["approve", b.backendId, "--code", request.code])).toContain("Backend approved");
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
