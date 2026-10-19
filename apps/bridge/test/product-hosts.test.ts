import { randomUUID } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { AtlasPage, AtlasItem } from "@mains/contracts/atlas";
import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import type { BridgeProjectScope, BridgeStatus } from "@mains/contracts/bridge";
import { startLocalBackends, waitFor } from "./local-backends";
import { signIn, approve } from "./auth-helpers";

type Host = Awaited<ReturnType<typeof startLocalBackends>>["a"];
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const page = (host: Host, title: string, markdown = title) => host.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title, markdown });
const get = (host: Host, id: string) => host.client.call<AtlasPage | null>(CHANNELS.atlas.get, { accountId: "default", id });
const received = (host: Host, id: string) => waitFor(() => get(host, id), (value) => !!value, "Page on other backend");

describe.skipIf(process.env.MAINS_BRIDGE_HOST_TESTS !== "1")("B8 through two independent backend processes", () => {
  it.each([false, true])("restores its own signed account objects after re-enrollment with a new random key (remove=%s)", async (remove) => {
    const fixture = await startLocalBackends({ auth: true }), { a, b } = fixture;
    try {
      const account = await signIn(fixture, a); await signIn(fixture, b); await approve(fixture);
      const collection = await b.client.call<{ id: string; name: string }>(CHANNELS.collections.create, { accountId: "default", name: "Own collection" });
      const own = await page(b, "Own Page", "Survives a new signing key");
      await b.client.call(CHANNELS.bridge.syncNow); await received(a, own.item.id); await a.client.call(CHANNELS.bridge.syncNow);
      const db = await fixture.hub.database();
      const signingKey = () => db.prepare("SELECT signing_public_key FROM bridge_backends WHERE account_id=? AND backend_id=?")
        .bind(account.accountId, b.backendId).first<{ signing_public_key: string }>();
      const before = await signingKey();
      await b.client.call(CHANNELS.bridge.signOut, remove); await b.stop(); await b.start();
      if (remove) expect(await get(b, own.item.id)).toBeNull();
      await signIn(fixture, b); await approve(fixture);
      expect((await signingKey())?.signing_public_key).not.toBe(before?.signing_public_key);
      await b.client.call(CHANNELS.bridge.syncNow);
      expect(await b.client.call(CHANNELS.collections.get, { accountId: "default", id: collection.id })).toMatchObject({ name: collection.name });
      expect((await get(b, own.item.id))?.revision.id).toBe(own.revision.id);
      expect((await b.client.call<BridgeStatus>(CHANNELS.bridge.getStatus)).rejectedRecords).toBe(0);
      await b.stop(); await b.start(); await b.client.call(CHANNELS.bridge.syncNow);
      expect((await get(b, own.item.id))?.revision.id).toBe(own.revision.id);
      expect((await b.client.call<BridgeStatus>(CHANNELS.bridge.getStatus)).rejectedRecords).toBe(0);
    } finally { await fixture.dispose(); }
  }, 120_000);
  it("does not reactivate an old development configuration after sign-out and restart", async () => {
    const fixture = await startLocalBackends(), { a, b } = fixture;
    try {
      const shared = await page(a, "Development config retention"); await a.client.call(CHANNELS.bridge.syncNow); await received(b, shared.item.id);
      await b.client.call(CHANNELS.bridge.signOut); await b.stop(); await b.start();
      expect(await b.client.call<BridgeStatus>(CHANNELS.bridge.getStatus)).toMatchObject({ enabled: false, state: "disabled" });
      expect((await get(b, shared.item.id))?.revision.id).toBe(shared.revision.id);
    } finally { await fixture.dispose(); }
  }, 60_000);
  it("finishes an interrupted sign-out after restart and keeps retained history local in a different account", async () => {
    const fixture = await startLocalBackends({ auth: true }), { a, b } = fixture;
    let suspended = false;
    try {
      await signIn(fixture, a); await signIn(fixture, b); await approve(fixture);
      const shared = await page(a, "Retain across accounts");
      const file = await a.client.call<AtlasItem>(CHANNELS.atlas.uploadFile, { accountId: "default", pageId: shared.item.id, fileName: "not-opened.png", data: image.toString("base64") });
      await a.client.call(CHANNELS.bridge.syncNow); await received(b, shared.item.id);
      await b.client.call(CHANNELS.bridge.syncNow);
      await fixture.hub.suspend(); suspended = true;
      expect(await b.client.invoke(CHANNELS.bridge.signOut)).toMatchObject({ success: false });
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).logoutPending).toBe(true);
      const offline = await page(b, "Written during interrupted logout");
      await b.stop(); await b.start();
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).logoutPending).toBe(true);
      expect((await get(b, offline.item.id))?.revision.id).toBe(offline.revision.id);
      await fixture.hub.resume(); suspended = false;
      await b.client.call(CHANNELS.bridge.signOut);
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus))).toMatchObject({ state: "signed-out", logoutPending: false });
      await expect(access(join(b.dir, "bridge", "identity.json"))).rejects.toThrow();
      const other = await signIn(fixture, b, "different@example.com", false); expect(other.state).toBe("ready");
      await b.client.call(CHANNELS.bridge.syncNow); await a.client.call(CHANNELS.bridge.syncNow);
      expect((await get(b, shared.item.id))?.revision.id).toBe(shared.revision.id); expect(await get(a, offline.item.id)).toBeNull();
      const db = await fixture.hub.database();
      const rows = await db.prepare("SELECT count(*) n FROM bridge_account_quotas WHERE account_id=?").bind(other.accountId).first<{ n: number }>(); expect(rows?.n).toBe(0);
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).localHistory).toBeGreaterThan(0);
      await b.client.call(CHANNELS.bridge.signOut);
      await signIn(fixture, b); await approve(fixture); await b.client.call(CHANNELS.bridge.syncNow);
      const opened = await b.client.call<string>(CHANNELS.atlas.resolveFile, { accountId: "default", id: file.id });
      expect(await readFile(opened)).toEqual(image);
    } finally { if (suspended) await fixture.hub.resume(); await fixture.dispose(); }
  }, 120_000);
  it("keeps a project private, resumes its chats and deletions, and preserves the paired remote-control path", async () => {
    const fixture = await startLocalBackends({ auth: true }), { a, b } = fixture;
    let ipad: Awaited<ReturnType<typeof a.pair>> | undefined;
    try {
      const root = join(a.dir, "project"); await mkdir(root);
      const project = await a.client.call(CHANNELS.projects.create, { accountId: "default", name: "Local project", rootPath: root });
      const workspace = await a.client.call(CHANNELS.workspace.create, { accountId: "default", name: "Local workspace", rootPath: root, projectId: project.id });
      await a.client.call(CHANNELS.bridge.setProjectLocalOnly, project.id, true);
      const runId = randomUUID();
      await a.client.call(CHANNELS.runs.create, { id: runId, accountId: "default", workspaceId: workspace.id, providerId: "codex", mode: "developer", title: "Private chat", status: "succeeded" });
      await signIn(fixture, a); await signIn(fixture, b); await approve(fixture);
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect(await b.client.call(CHANNELS.runs.getById, runId)).toBeNull(); expect(await b.client.call(CHANNELS.projects.get, project.id)).toBeNull();
      expect(await a.client.call<BridgeProjectScope[]>(CHANNELS.bridge.getProjectScopes)).toMatchObject([{ id: project.id, localOnly: true, runs: 1 }]);
      ipad = await a.pair();
      expect((await ipad.call(CHANNELS.runs.getById, runId)).title).toBe("Private chat");
      expect(await ipad.invoke(CHANNELS.bridge.setProjectLocalOnly, project.id, false)).toMatchObject({ success: false });
      await a.client.call(CHANNELS.bridge.setProjectLocalOnly, project.id, false);
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect(await b.client.call(CHANNELS.runs.getById, runId)).toMatchObject({ title: "Private chat", isReplica: true });
      await a.client.call(CHANNELS.bridge.setProjectLocalOnly, project.id, true);
      await a.client.call(CHANNELS.runs.update, runId, { title: "Unsent private edit" });
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect((await b.client.call(CHANNELS.runs.getById, runId)).title).toBe("Private chat");
      await a.client.call(CHANNELS.bridge.setProjectLocalOnly, project.id, false);
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect((await b.client.call(CHANNELS.runs.getById, runId)).title).toBe("Unsent private edit");
      await b.client.call(CHANNELS.bridge.signOut);
      expect(await b.client.call(CHANNELS.runs.getById, runId)).toBeNull();
      expect((await ipad.call(CHANNELS.runs.getById, runId)).title).toBe("Unsent private edit");
      expect((await signIn(fixture, b)).state).toBe("needs-approval"); await approve(fixture);
      await b.client.call(CHANNELS.bridge.syncNow);
      expect(await b.client.call(CHANNELS.runs.getById, runId)).toMatchObject({ isReplica: true });
    } finally { ipad?.close(); await fixture.dispose(); }
  }, 120_000);

  it("keeps old history local on first sign-in and preserves opened images and unsent edits through logout/re-entry", async () => {
    const fixture = await startLocalBackends({ auth: true }), { a, b } = fixture;
    try {
      await signIn(fixture, a);
      const original = await page(a, "Shared Page");
      const file = await a.client.call<AtlasItem>(CHANNELS.atlas.uploadFile, { accountId: "default", pageId: original.item.id, fileName: "kept.png", data: image.toString("base64") });
      await a.client.call(CHANNELS.bridge.syncNow);
      const old = await page(b, "Old local history");
      await signIn(fixture, b, "owner@example.com", false);
      const duringApproval = await page(b, "Created while approval pending");
      await approve(fixture); await b.client.call(CHANNELS.bridge.syncNow); await a.client.call(CHANNELS.bridge.syncNow);
      expect(await get(a, old.item.id)).toBeNull(); expect(await get(a, duringApproval.item.id)).toBeTruthy();
      await received(b, original.item.id);
      const cached = await b.client.call<string>(CHANNELS.atlas.resolveFile, { accountId: "default", id: file.id });
      expect(cached.startsWith(join(b.dir, "bridge", "blobs"))).toBe(true); expect(await readFile(cached)).toEqual(image);
      await b.client.call(CHANNELS.bridge.signOut);
      expect((await get(b, original.item.id))?.revision.markdown).toBe(original.revision.markdown);
      const local = await b.client.call<string>(CHANNELS.atlas.resolveFile, { accountId: "default", id: file.id });
      expect(local.startsWith(join(b.dir, "atlas", "files"))).toBe(true); expect(await readFile(local)).toEqual(image);
      await expect(access(join(b.dir, "bridge", "identity.json"))).rejects.toThrow(); await expect(access(cached)).rejects.toThrow();
      const edit = await b.client.call<AtlasPage>(CHANNELS.atlas.savePage, { accountId: "default", id: original.item.id, expectedVersion: original.item.version, title: "Offline after logout", markdown: "Unsent text" });
      const localNew = await page(b, "Created after logout");
      await b.stop(); await b.start();
      expect((await get(b, original.item.id))?.revision.id).toBe(edit.revision.id);
      expect((await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).state).toBe("signed-out");
      await signIn(fixture, b); await approve(fixture); await b.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => get(a, original.item.id), (value) => value?.revision.id === edit.revision.id, "logged-out edit on A");
      expect(await received(a, localNew.item.id)).toBeTruthy(); expect(await get(a, old.item.id)).toBeNull();
      await b.client.call(CHANNELS.bridge.includeLocalHistory); await b.client.call(CHANNELS.bridge.syncNow); await a.client.call(CHANNELS.bridge.syncNow);
      expect(await get(a, old.item.id)).toBeTruthy();
      await b.client.call(CHANNELS.bridge.signOut, true);
      expect(await get(b, original.item.id)).toBeNull(); expect(await get(a, original.item.id)).toBeTruthy();
    } finally { await fixture.dispose(); }
  }, 120_000);

  it("keeps over-quota records/files queued, permits deletion, and resumes after a plan increase", async () => {
    const fixture = await startLocalBackends({ auth: true }), { a, b } = fixture;
    try {
      const auth = await signIn(fixture, a); await signIn(fixture, b); await approve(fixture);
      const removable = await page(a, "Delete while full"); await a.client.call(CHANNELS.bridge.syncNow); await received(b, removable.item.id);
      const db = await fixture.hub.database();
      await db.prepare("INSERT INTO bridge_account_quotas(account_id,plan,storage_limit_bytes,writes_per_minute) VALUES(?,'small',0,600)").bind(auth.accountId).run();
      // Console-style D1 changes wait for the policy TTL. Reopen this local DO
      // to drop its cache immediately; real D1 TTL/invalidation behavior has
      // separate coverage, without adding a minute to this host scenario.
      await fixture.hub.evict(auth.accountId!);
      const pending = await page(a, "Queued Page", "Pending content ".repeat(4000));
      const file = await a.client.call<AtlasItem>(CHANNELS.atlas.uploadFile, { accountId: "default", pageId: pending.item.id, fileName: "queued.png", data: image.toString("base64") });
      expect(await a.client.invoke(CHANNELS.bridge.syncNow)).toMatchObject({ success: false });
      const status = await a.client.call<BridgeStatus>(CHANNELS.bridge.getStatus);
      expect(status.pendingRecords).toBeGreaterThan(0); expect(status.error).toMatch(/quota/); expect(status.quota).toMatchObject({ plan: "small", limitBytes: 0 });
      expect((await get(a, pending.item.id))?.revision.id).toBe(pending.revision.id); expect(await get(b, pending.item.id)).toBeNull();
      await a.client.call(CHANNELS.atlas.update, { accountId: "default", id: removable.item.id, trashed: true });
      await a.client.call(CHANNELS.atlas.remove, { accountId: "default", id: removable.item.id });
      await a.client.invoke(CHANNELS.bridge.syncNow); await b.client.invoke(CHANNELS.bridge.syncNow);
      expect(await get(b, removable.item.id)).toBeNull();
      await db.prepare("UPDATE bridge_account_quotas SET storage_limit_bytes=?,plan='expanded' WHERE account_id=?").bind(1024 ** 2, auth.accountId).run();
      await fixture.hub.evict(auth.accountId!);
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect((await get(b, pending.item.id))?.revision.id).toBe(pending.revision.id);
      const opened = await b.client.call<string>(CHANNELS.atlas.resolveFile, { accountId: "default", id: file.id }); expect(await readFile(opened)).toEqual(image);
      expect((await a.client.call<BridgeStatus>(CHANNELS.bridge.getStatus)).pendingRecords).toBe(0);
    } finally { await fixture.dispose(); }
  }, 120_000);
});
