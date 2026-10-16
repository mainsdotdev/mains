import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import type { AtlasItem, AtlasPage } from "@mains/contracts/atlas";
import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { startLocalBackends, waitFor } from "./local-backends";
import { approve, signIn } from "./auth-helpers";

type Host = Awaited<ReturnType<typeof startLocalBackends>>["a"];
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const page = (host: Host, title: string, markdown = title) => host.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title, markdown });
const get = (host: Host, id: string) => host.client.call<AtlasPage | null>(CHANNELS.atlas.get, { accountId: "default", id });
const status = (host: Host) => host.client.call<BridgeStatus>(CHANNELS.bridge.getStatus);

describe.skipIf(process.env.MAINS_BRIDGE_HOST_TESTS !== "1")("Subscriptions through real D1, R2 and two backend processes", () => {
  it("keeps unpaid/expired edits durable, allows recovery/reads/deletes, and resumes with the same keys after renewal", async () => {
    const fixture = await startLocalBackends({ auth: true, subscriptionInterval: null }), { a, b } = fixture;
    try {
      const owner = await signIn(fixture, a); expect(owner.state).toBe("ready");
      // Account/device approval does not itself grant a subscription.
      await signIn(fixture, b); await approve(fixture);
      const original = await page(a, "Initially unpaid", "Private text ".repeat(4000));
      const file = await a.client.call<AtlasItem>(CHANNELS.atlas.uploadFile, { accountId: "default", pageId: original.item.id, fileName: "private.png", data: image.toString("base64") });
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect(await status(a)).toMatchObject({ state: "read-only", error: null, quota: { subscription: { status: "none", canUpload: false } } });
      expect((await status(a)).pendingRecords).toBeGreaterThan(0);
      expect((await get(a, original.item.id))?.revision.id).toBe(original.revision.id);
      expect(await get(b, original.item.id)).toBeNull();

      await fixture.hub.grantSubscription(owner.accountId!, "monthly"); await fixture.hub.evict(owner.accountId!);
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => get(b, original.item.id), (value) => value?.revision.id === original.revision.id, "monthly Page on B");
      expect((await get(b, original.item.id))?.revision.markdown).toBe(original.revision.markdown);
      expect(await status(a)).toMatchObject({ state: "connected", pendingRecords: 0, quota: { subscription: { status: "active", billingInterval: "monthly" } } });
      const removable = await page(a, "Delete while expired");
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect(await get(b, removable.item.id)).not.toBeNull();

      const db = await fixture.hub.database(), now = Date.now();
      await db.prepare("UPDATE account_entitlements SET starts_at=?,expires_at=? WHERE account_id=? AND feature='bridge'").bind(now - 60_000, now - 1, owner.accountId).run();
      await fixture.hub.evict(owner.accountId!);
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect(await status(a)).toMatchObject({ state: "read-only", quota: { subscription: { status: "expired" } } });
      // This file has never been opened on B; the first R2 download is after expiry.
      const opened = await b.client.call<string>(CHANNELS.atlas.resolveFile, { accountId: "default", id: file.id });
      expect(await readFile(opened)).toEqual(image);

      const edit = await a.client.call<AtlasPage>(CHANNELS.atlas.savePage, { accountId: "default", id: original.item.id, expectedVersion: original.item.version, title: "Expired edit", markdown: "Queued content ".repeat(5000) });
      const queued = await page(a, "Created while expired");
      const queuedFile = await a.client.call<AtlasItem>(CHANNELS.atlas.uploadFile, { accountId: "default", pageId: queued.item.id, fileName: "queued.png", data: image.toString("base64") });
      await a.client.call(CHANNELS.atlas.update, { accountId: "default", id: removable.item.id, trashed: true });
      await a.client.call(CHANNELS.atlas.remove, { accountId: "default", id: removable.item.id });
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      expect(await get(b, removable.item.id)).toBeNull();
      expect((await get(b, original.item.id))?.revision.id).toBe(original.revision.id);
      expect(await get(b, queued.item.id)).toBeNull();
      expect((await status(a)).pendingRecords).toBeGreaterThan(0);

      await a.stop(); await a.start();
      await a.client.call(CHANNELS.bridge.syncNow);
      expect(await a.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).toMatchObject({ state: "ready", accountId: owner.accountId, backendId: owner.backendId });
      expect(await status(a)).toMatchObject({ state: "read-only", error: null });
      expect((await get(a, original.item.id))?.revision.id).toBe(edit.revision.id);
      expect((await status(a)).pendingRecords).toBeGreaterThan(0);

      await fixture.hub.grantSubscription(owner.accountId!, "yearly"); await fixture.hub.evict(owner.accountId!);
      await a.client.call(CHANNELS.bridge.syncNow); await b.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => get(b, original.item.id), (value) => value?.revision.id === edit.revision.id, "renewed edit on B");
      expect((await get(b, original.item.id))?.revision.markdown).toBe(edit.revision.markdown);
      expect((await get(b, queued.item.id))?.revision.id).toBe(queued.revision.id);
      const resumedFile = await b.client.call<string>(CHANNELS.atlas.resolveFile, { accountId: "default", id: queuedFile.id });
      expect(await readFile(resumedFile)).toEqual(image);
      expect(await status(a)).toMatchObject({ state: "connected", pendingRecords: 0, quota: { subscription: { status: "active", billingInterval: "yearly" } } });
      expect(await b.client.call<BridgeAuthStatus>(CHANNELS.bridge.getAuthStatus)).toMatchObject({ state: "ready", accountId: owner.accountId });
    } finally { await fixture.dispose(); }
  }, 120_000);
});
