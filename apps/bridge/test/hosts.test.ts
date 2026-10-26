import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHANNELS } from "@mains/contracts/channels";
import type { AtlasPage, AtlasItem } from "@mains/contracts/atlas";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { startLocalBackends, waitFor } from "./local-backends";

describe.skipIf(process.env.MAINS_BRIDGE_HOST_TESTS !== "1")("Bridge through two real Mains server processes", () => {
  it.each(["current", "other"] as const)("synchronizes Atlas branches and resolves %s across real backends", async (choice) => {
    const fixture = await startLocalBackends(); const { a, b } = fixture;
    try {
      const base = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Shared Atlas", markdown: "Base" });
      const identity = { accountId: "default", id: base.item.id };
      const before = await waitFor(() => b.client.call<AtlasPage | null>(CHANNELS.atlas.get, identity), (value) => value?.revision.id === base.revision.id, "Atlas Page on B");
      // Keep B's actual backend and editor API running pointed at an unavailable
      // network endpoint. Persisted SQL capture continues while its hub is unavailable.
      await b.stop();
      const onlineConfig = await readFile(b.configFile, "utf8");
      await writeFile(b.configFile, JSON.stringify({ ...JSON.parse(onlineConfig), url: "ws://127.0.0.1:1/v1/log" }));
      await b.start();
      await a.client.call(CHANNELS.atlas.savePage, { ...identity, expectedVersion: base.item.version, title: "Branch A", markdown: "A content" });
      await b.client.call(CHANNELS.atlas.update, { ...identity, isFavorite: true });
      await b.client.call(CHANNELS.atlas.savePage, { ...identity, expectedVersion: before!.item.version, title: "Branch B", markdown: "B content" });
      await b.stop(); await writeFile(b.configFile, onlineConfig); await b.start();
      const branched = await waitFor(() => a.client.call<AtlasPage>(CHANNELS.atlas.get, identity), (value) => value.conflicts?.length === 1 && value.item.isFavorite, "Atlas conflict and stale favourite");
      await waitFor(() => b.client.call<AtlasPage>(CHANNELS.atlas.get, identity), (value) => value.conflicts?.[0]?.id === branched.conflicts![0].id, "same conflict on B");
      const merged = await a.client.call<AtlasPage>(CHANNELS.atlas.resolveConflict, { ...identity, expectedVersion: branched.item.version, revisionId: branched.conflicts![0].id, choice });
      expect(merged.item.title).toBe(choice === "current" ? branched.item.title : branched.conflicts![0].title);
      expect(merged.revision.parentRevisionId).toBe(branched.revision.id);
      expect(merged.revision.mergedRevisionId).toBe(branched.conflicts![0].id);
      const result = await waitFor(() => b.client.call<AtlasPage>(CHANNELS.atlas.get, identity), (value) => value.revision.id === merged.revision.id && value.conflicts?.length === 0, "resolved graph on B");
      expect(result.item.isFavorite).toBe(true);
      // History groups edits from one session into a checkpoint. Check the underlying graph
      // through getRevision so a shortened history list cannot hide a missing replicated branch.
      const revisionIds = [base.revision.id, branched.revision.id, branched.conflicts![0].id, merged.revision.id];
      expect(new Set(revisionIds).size).toBe(4);
      const retained = await Promise.all(revisionIds.map((revisionId) => b.client.call<{ id: string }>(CHANNELS.atlas.getRevision, { ...identity, revisionId })));
      expect(retained.map((revision) => revision.id)).toEqual(revisionIds);
      expect(await b.client.call<{ id: string }[]>(CHANNELS.atlas.revisions, identity)).toContainEqual(expect.objectContaining({ id: merged.revision.id }));
      expect(await b.client.invoke(CHANNELS.atlas.savePage, { ...identity, expectedVersion: before!.item.version, title: "Stale", markdown: "Do not overwrite" })).toMatchObject({ success: false });
    } finally { await fixture.dispose(); }
  }, 60_000);

  it("recovers an offline Atlas Page and its embedded image before a remote delete cascades", async () => {
    const fixture = await startLocalBackends(); const { a, b } = fixture;
    try {
      const base = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Recover me", markdown: "Base" });
      const identity = { accountId: "default", id: base.item.id };
      const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
      const file = await a.client.call<AtlasItem>(CHANNELS.atlas.uploadFile, { accountId: "default", pageId: base.item.id, fileName: "atlas.png", data: image.toString("base64") });
      await a.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => b.client.call<AtlasItem[]>(CHANNELS.atlas.list, { accountId: "default" }), (rows) => rows.some((row) => row.id === file.id), "image metadata on B");
      await waitFor(() => b.client.call<AtlasPage | null>(CHANNELS.atlas.get, identity), (value) => value?.revision.id === base.revision.id, "base on B");
      await b.stop();
      const onlineConfig = await readFile(b.configFile, "utf8");
      await writeFile(b.configFile, JSON.stringify({ ...JSON.parse(onlineConfig), url: "ws://127.0.0.1:1/v1/log" }));
      await b.start();
      await b.client.call(CHANNELS.atlas.savePage, { ...identity, expectedVersion: 1, title: "Offline notes", markdown: `Written offline\n\n![Image](atlas-file://${file.id})` });
      await a.client.call(CHANNELS.atlas.update, { ...identity, trashed: true }); await a.client.call(CHANNELS.atlas.remove, identity);
      await a.client.call(CHANNELS.atlas.update, { accountId: "default", id: file.id, trashed: true });
      await a.client.call(CHANNELS.atlas.remove, { accountId: "default", id: file.id });
      await a.client.call(CHANNELS.bridge.syncNow);
      await b.stop(); await writeFile(b.configFile, onlineConfig); await b.start();
      const recovered = await waitFor(() => b.client.call<AtlasItem[]>(CHANNELS.atlas.list, { accountId: "default", kind: "page" }), (rows) => rows.some((row) => row.title === "Offline notes (recovered)"), "recovered Page");
      const copy = recovered.find((row) => row.title === "Offline notes (recovered)")!;
      expect(copy.id).not.toBe(base.item.id);
      const page = await b.client.call<AtlasPage>(CHANNELS.atlas.get, { accountId: "default", id: copy.id });
      const copiedFileId = page.revision.markdown.match(/atlas-file:\/\/([\w-]+)/)![1];
      expect(copiedFileId).not.toBe(file.id);
      const path = await b.client.call<string>(CHANNELS.atlas.resolveFile, { accountId: "default", id: copiedFileId });
      expect(path.startsWith(join(b.dir, "bridge", "blobs"))).toBe(true);
      expect(await readFile(path)).toEqual(image);
      await b.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => a.client.call<AtlasPage | null>(CHANNELS.atlas.get, { accountId: "default", id: copy.id }), (value) => value?.revision.id === page.revision.id, "recovered copy on A");
      expect(await b.client.call(CHANNELS.atlas.get, identity)).toBeNull();
      expect(await b.client.call(CHANNELS.atlas.get, { accountId: "default", id: file.id })).toBeNull();
      expect(await a.client.call(CHANNELS.atlas.get, identity)).toBeNull();
    } finally { await fixture.dispose(); }
  }, 60_000);

  it("restores a historical Atlas revision and opens its image on B while A is offline", async () => {
    const fixture = await startLocalBackends(); const { a, b } = fixture;
    try {
      const base = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "History", markdown: "Before image" });
      const identity = { accountId: "default", id: base.item.id };
      const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
      const file = await a.client.call<AtlasItem>(CHANNELS.atlas.uploadFile, { accountId: "default", pageId: base.item.id, fileName: "historical.png", data: image.toString("base64") });
      const embedded = await a.client.call<AtlasPage>(CHANNELS.atlas.savePage, { ...identity, expectedVersion: base.item.version, title: "With image", markdown: `![Historical](atlas-file://${file.id})` });
      const latest = await a.client.call<AtlasPage>(CHANNELS.atlas.savePage, { ...identity, expectedVersion: embedded.item.version, title: "Image removed", markdown: "Text only now" });
      const received = await waitFor(() => b.client.call<AtlasPage | null>(CHANNELS.atlas.get, identity), (value) => value?.revision.id === latest.revision.id, "current Page on B");
      await a.stop(); await unlink(file.path!);
      const restored = await b.client.call<AtlasPage>(CHANNELS.atlas.restore, { ...identity, revisionId: embedded.revision.id, expectedVersion: received!.item.version });
      expect(restored.revision.blocks).toEqual(embedded.revision.blocks);
      expect(restored.revision.parentRevisionId).toBe(latest.revision.id);
      expect(restored.conflicts).toEqual([]);
      const path = await b.client.call<string>(CHANNELS.atlas.resolveFile, { accountId: "default", id: file.id });
      expect(path.startsWith(join(b.dir, "bridge", "blobs"))).toBe(true); expect(await readFile(path)).toEqual(image);
      await b.client.call(CHANNELS.atlas.update, { accountId: "default", id: file.id, trashed: true });
      expect(await b.client.invoke(CHANNELS.atlas.remove, { accountId: "default", id: file.id })).toMatchObject({ success: false });
    } finally { await fixture.dispose(); }
  }, 60_000);

  it("opens A's image and document on B after the source is stopped, then reopens from cache offline", async () => {
    const fixture = await startLocalBackends(); const { a, b } = fixture;
    try {
      const account = await a.client.call(CHANNELS.account.get), runId = randomUUID();
      await a.client.call(CHANNELS.runs.create, { id: runId, accountId: account.id, providerId: "codex", mode: "work", title: "Shared image", status: "succeeded" });
      const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
      const outputDir = join(a.dir, "runs", runId, "work"); await mkdir(outputDir, { recursive: true });
      const file = join(outputDir, "shared-image.png"); await writeFile(file, image);
      await a.client.call(CHANNELS.runArtifacts.add, { runId, kind: "image", path: file, metadata: { path: file, fileName: "shared-image.png", turnIndex: 0 } });
      const pdf = Buffer.from("%PDF-1.4\nBridge document fixture\n%%EOF\n"), document = join(outputDir, "shared.pdf"); await writeFile(document, pdf);
      await a.client.call(CHANNELS.runArtifacts.add, { runId, kind: "document", path: document, metadata: { path: document, fileName: "shared.pdf", docType: "pdf", turnIndex: 0 } });
      await a.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => b.client.call(CHANNELS.runs.getById, runId), (run) => run?.isReplica === true, "image run root");
      await b.client.call(CHANNELS.bridge.watchRun, runId, "files-test");
      const rows = await waitFor(() => b.client.call<any[]>(CHANNELS.runArtifacts.getByRun, runId), (rows) => rows.some((row) => row.kind === "document"), "file manifests");
      const imageRow = rows.find((row) => row.kind === "image"), pdfRow = rows.find((row) => row.kind === "document");
      expect((await readdir(join(b.dir, "bridge", "blobs")).catch(() => [])).filter((name) => !name.startsWith("."))).toEqual([]);
      await a.stop();
      await unlink(file); await unlink(document); // Same-machine test cannot accidentally read A's originals.
      const preview = await b.client.call(CHANNELS.runArtifacts.readImage, { artifactId: imageRow.id, runId });
      expect(preview.mime).toMatch(/^image\//); expect(preview.base64.length).toBeGreaterThan(20);
      const cachePath = await b.client.call<string>(CHANNELS.runArtifacts.resolveFilePath, { artifactId: imageRow.id, runId });
      expect(cachePath.startsWith(join(b.dir, "bridge", "blobs"))).toBe(true); expect(await readFile(cachePath)).toEqual(image);
      const pdfPath = await b.client.call<string>(CHANNELS.runArtifacts.resolveFilePath, { artifactId: pdfRow.id, runId }); expect(await readFile(pdfPath)).toEqual(pdf);
      expect(await b.client.invoke(CHANNELS.runArtifacts.resolveFilePath, { artifactId: imageRow.id, runId: "unrelated" })).toMatchObject({ success: false });
      expect(await b.client.invoke(CHANNELS.runArtifacts.resolveFilePath, { sourcePath: "/etc/passwd", runId })).toMatchObject({ success: false });
      await b.stop(); await b.start();
      expect((await b.client.call(CHANNELS.runArtifacts.readImage, { artifactId: imageRow.id, runId })).base64).toBe(preview.base64);
    } finally { await fixture.dispose(); }
  }, 90_000);
  it("preserves source remote control while a second backend lazily views live and offline replicas", async () => {
    const fixture = await startLocalBackends();
    const { a, b } = fixture;
    let ipad: Awaited<ReturnType<typeof a.pair>> | undefined;
    try {
      const account = await a.client.call(CHANNELS.account.get);
      const root = join(a.dir, "demo-project"); await mkdir(root);
      const project = await a.client.call(CHANNELS.projects.create, { accountId: account.id, rootPath: root, name: "Bridge acceptance" });
      const workspace = await a.client.call(CHANNELS.workspace.create, { accountId: account.id, rootPath: root, name: "Source workspace", projectId: project.id });
      const runId = randomUUID();
      await a.client.call(CHANNELS.runs.create, { id: runId, accountId: account.id, workspaceId: workspace.id, providerId: "codex", mode: "developer", title: "Bridge acceptance chat", status: "running" });
      await a.client.call(CHANNELS.runArtifacts.add, { runId, kind: "report", content: "First live message from A", metadata: { turnIndex: 0 } });
      await a.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => b.client.call(CHANNELS.runs.getById, runId), (run) => run?.isReplica === true, "replicated run root");
      expect(await b.client.call(CHANNELS.workspace.get, workspace.id)).toMatchObject({ ownerBackendId: a.backendId, isReplica: true });
      expect(await b.client.call(CHANNELS.runArtifacts.getByRun, runId)).toEqual([]);

      await b.client.call(CHANNELS.bridge.watchRun, runId, "acceptance-web");
      await waitFor(() => b.client.call(CHANNELS.runArtifacts.getByRun, runId), (rows) => rows.some((row: any) => row.content === "First live message from A"), "lazy transcript hydration");
      expect(await b.client.invoke(CHANNELS.runs.update, runId, { title: "Wrong backend" })).toMatchObject({ success: false, error: expect.stringMatching(/read.only|another backend/i) });
      expect(await b.client.invoke(CHANNELS.runs.abort, runId)).toMatchObject({ success: false });
      expect(await b.client.invoke(CHANNELS.workspace.update, workspace.id, { name: "Wrong backend" })).toMatchObject({ success: false });

      // A connected mobile device still controls A's own conversation with Bridge enabled.
      ipad = await a.pair();
      expect(await ipad.call(CHANNELS.runs.getById, runId)).toMatchObject({ isReplica: false, ownerBackendId: a.backendId });
      await ipad.call(CHANNELS.runs.updateConversationSettings, runId, { model: "gpt-5", config: { sandboxMode: "read-only" } });
      expect(await a.client.call(CHANNELS.runs.getById, runId)).toMatchObject({ configSnapshot: { conversationSettings: { model: "gpt-5" } } });
      await waitFor(() => b.client.call(CHANNELS.runs.getById, runId), (run) => run?.configSnapshot?.conversationSettings?.model === "gpt-5", "paired-device settings captured as portable JSON text");
      await a.client.call(CHANNELS.runs.update, runId, { title: "Changed remotely on A" });
      await a.client.call(CHANNELS.runArtifacts.add, { runId, kind: "report", content: "Second live message from A", metadata: { turnIndex: 1 } });
      // No explicit Bridge pump: the background lifecycle must deliver this while B is watching.
      await waitFor(() => b.client.call(CHANNELS.runArtifacts.getByRun, runId), (rows) => rows.some((row: any) => row.content === "Second live message from A"), "automatic live transcript update");
      expect(await b.client.call(CHANNELS.runs.getById, runId)).toMatchObject({ title: "Changed remotely on A" });
      const login = await b.webLogin(); expect(new URL(login).origin).toBe(b.url);
      expect((await fetch(b.url)).status).toBe(200);

      ipad.close(); ipad = undefined; await a.stop();
      const status = await waitFor(() => b.client.call<BridgeStatus>(CHANNELS.bridge.getStatus), (value) => value.backends.some((peer) => peer.backendId === a.backendId && peer.online === false), "offline presence");
      expect(status.backends.find((peer) => peer.backendId === a.backendId)).toMatchObject({ label: "Computer A", online: false, lastSeen: expect.any(String) });
      expect(await b.client.call(CHANNELS.runArtifacts.getByRun, runId)).toHaveLength(2);
      await b.stop(); await b.start();
      expect(await b.client.call(CHANNELS.runArtifacts.getByRun, runId)).toHaveLength(2);
      expect(await b.client.call(CHANNELS.runs.getById, runId)).toMatchObject({ isReplica: true });
    } finally { ipad?.close(); await fixture.dispose(); }
  }, 90_000);
});
