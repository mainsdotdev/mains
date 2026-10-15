import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHANNELS } from "@mains/contracts/channels";
import type { BridgeStatus } from "@mains/contracts/bridge";
import { startLocalBackends, waitFor } from "./local-backends";

describe.skipIf(process.env.MAINS_BRIDGE_HOST_TESTS !== "1")("Bridge through two real Mains server processes", () => {
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
