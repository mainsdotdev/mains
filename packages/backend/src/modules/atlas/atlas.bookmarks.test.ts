import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createTestDb } from "../../../test/setup-db";
import { createAccount } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
import { atlasRepo } from "./atlas.repo";
import { atlasService } from "./atlas.service";
import { appSettingsService } from "../appSettings";
import { atlasBookmarks } from "./atlas.bookmarks";
import { bookmarkUrl, extractBookmarkMetadata, fetchBookmarkResource } from "./atlas.bookmark-metadata";

const ai = vi.hoisted(() => ({ generate: vi.fn(), models: vi.fn(async () => [{ id: "cheap", displayName: "Small model" }]) }));
let db: DatabaseInstance, cleanup: () => void, restore: () => void, directory: string;
vi.mock("../../db/client", () => ({ getDb: () => db }));
vi.mock("../imageProxy", async (original) => ({ ...await original<typeof import("../imageProxy")>(), assertPublicHttpUrl: vi.fn(async () => {}) }));
vi.mock("../providers", () => ({ providersService: { getById: vi.fn(async (id: string) => ({ id, isEnabled: true })) } }));
vi.mock("../providers/adapters/adapter.factory", () => ({ createWorkAdapter: () => ({ generateText: ai.generate, listModels: ai.models }) }));
const page = `<html><head><meta content="A &amp; B" property="og:title"><meta property="og:description" content="Useful React documentation"><meta property="og:image" content="/cover.png"></head><body><article>React performance and rendering</article><script>do not index scripts</script></body></html>`;
const accountId = "default";
const waitForReady = (id: string) => vi.waitFor(() => expect(atlasService.get({ id, accountId })?.bookmarkState?.status).toBe("ready"));
beforeEach(() => {
  ({ db, cleanup } = createTestDb()); createAccount(db);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-bookmarks-"));
  restore = installTestBackendRuntime({ getPath: () => directory });
  ai.generate.mockReset().mockResolvedValue('{"tags":["React","Performance","Documentation"],"type":"documentation"}');
  ai.models.mockReset().mockResolvedValue([{ id: "cheap", displayName: "Small model" }]);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith(".png") ? new Uint8Array([137, 80, 78, 71]) : page,
    { headers: { "content-type": url.endsWith(".png") ? "image/png" : "text/html" } })));
});
afterEach(async () => { await atlasBookmarks.stop(); cleanup(); restore(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Atlas bookmarks", () => {
  it("normalizes only tracking parameters and preserves content queries and fragment routes", () => {
    expect(bookmarkUrl("https://example.com/docs?id=7&utm_source=mail#/intro").normalizedUrl).toBe("https://example.com/docs?id=7#/intro");
    expect(() => bookmarkUrl("file:///etc/passwd")).toThrow();
    expect(() => bookmarkUrl("https://user:secret@example.com")).toThrow();
  });
  it("reads real HTML attributes/entities, resolves images, and excludes executable text", () => {
    const data = extractBookmarkMetadata(page, "https://example.com/article");
    expect(data).toMatchObject({ title: "A & B", imageUrl: "https://example.com/cover.png", description: "Useful React documentation", text: "React performance and rendering" });
  });
  it("saves before fetching, deduplicates by normalized URL, and restores a saved URL from Trash", async () => {
    const item = await atlasService.saveBookmark({ accountId, url: "https://example.com/?utm_source=mail", tags: ["Research"] });
    expect(item).toMatchObject({ kind: "bookmark", title: "example.com", bookmarkState: { status: "pending" }, tags: [{ name: "Research", source: "user" }] });
    expect(fetch).not.toHaveBeenCalled();
    const duplicate = await atlasService.saveBookmark({ accountId, url: "https://example.com/", title: "Do not replace" });
    expect(duplicate.id).toBe(item.id); expect(duplicate.title).toBe("example.com");
    await atlasService.update({ accountId, id: item.id, trashed: true });
    expect((await atlasService.saveBookmark({ accountId, url: item.url! })).trashedAt).toBeNull();
  });
  it("keeps stable tag identities across rename and removes only relationships on tag deletion", async () => {
    const a = await atlasService.saveBookmark({ accountId, url: "https://example.com/a", tags: ["React"] });
    const b = await atlasService.saveBookmark({ accountId, url: "https://example.com/b", tags: ["react"] });
    const tag = a.tags![0]; expect(b.tags![0].id).toBe(tag.id);
    atlasService.renameTag({ accountId, id: tag.id, name: "Frontend" });
    expect(atlasService.get({ accountId, id: a.id })?.tags).toEqual([{ id: tag.id, name: "Frontend", source: "user" }]);
    expect((await atlasService.library({ accountId, tagId: tag.id, query: "frontend" })).items).toHaveLength(2);
    atlasService.removeTag({ accountId, id: tag.id });
    expect(atlasService.get({ accountId, id: a.id })?.tags).toEqual([]);
    expect(atlasService.list({ accountId })).toHaveLength(2);
  });
  it("rejects foreign tags and invalid input without leaving a partial bookmark", async () => {
    createAccount(db, { id: "other" });
    atlasRepo.insert({ id: "foreign", accountId: "other", kind: "page", title: "Other" });
    atlasRepo.setTags("foreign", "other", ["Private"], "user");
    const foreign = atlasRepo.listTags("other")[0];
    await expect(atlasService.saveBookmark({ accountId, url: "https://example.com/private", tags: [foreign.id] })).rejects.toThrow("different account");
    expect(atlasService.list({ accountId })).toHaveLength(0);
  });
  it("replaces outdated AI topics while preserving manual tags and user exclusions", async () => {
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com", tags: ["Research"] });
    atlasRepo.setTags(saved.id, accountId, ["React", "Frontend"], "ai");
    atlasService.setTags({ accountId, id: saved.id, tags: ["Research", "Frontend"] });
    atlasRepo.setTags(saved.id, accountId, ["React", "Design"], "ai");
    expect(atlasService.get({ accountId, id: saved.id })?.tags?.map((tag) => tag.name)).toEqual(["Design", "Research"]);
  });
  it("resumes pending work, caches the OG preview, and preserves authored fields", async () => {
    const item = await atlasService.saveBookmark({ accountId, url: "https://example.com", title: "My title", description: "My description", note: "Keep this" });
    atlasBookmarks.start(); await waitForReady(item.id);
    const ready = atlasService.get({ accountId, id: item.id })!;
    expect(ready).toMatchObject({ title: "My title", description: "My description", note: "Keep this", metadata: { bookmark: { siteName: "example.com" } } });
    expect(fs.existsSync(ready.bookmarkImagePath!)).toBe(true); expect(ready.path).toBeNull();
    expect(ai.generate).not.toHaveBeenCalled();
  });
  it("uses the selected model, skips unchanged analyses and respects a removed AI tag", async () => {
    await atlasService.setAutoTagging({ accountId, config: { enabled: true, providerId: "codex", model: "cheap" } });
    const item = await atlasService.saveBookmark({ accountId, url: "https://example.com", tags: ["Research"] });
    atlasBookmarks.start(); await waitForReady(item.id);
    expect(ai.generate).toHaveBeenCalledTimes(1); expect(ai.generate.mock.calls[0][1].model).toBe("cheap");
    const before = atlasService.get({ accountId, id: item.id })!;
    expect(before.tags?.find((tag) => tag.name === "Research")?.source).toBe("user");
    await atlasService.saveBookmark({ accountId, id: item.id, url: item.url!, note: "Only a note changed" });
    await waitForReady(item.id); expect(ai.generate).toHaveBeenCalledTimes(1);
    atlasService.setTags({ accountId, id: item.id, tags: ["Research"] });
    await atlasService.enrichBookmark({ accountId, id: item.id }); await waitForReady(item.id);
    expect(atlasService.get({ accountId, id: item.id })?.tags?.map((tag) => tag.name)).toEqual(["Research"]);
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });
  it("refreshes the cached preview when a site's Open Graph image changes", async () => {
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    atlasBookmarks.start(); await waitForReady(saved.id);
    const previous = atlasService.get({ accountId, id: saved.id })!.bookmarkImagePath;
    vi.mocked(fetch).mockImplementation(async (url) => new Response(String(url).endsWith(".png") ? new Uint8Array([137, 80, 78, 71, 1]) : page.replace("/cover.png", "/new-cover.png"),
      { headers: { "content-type": String(url).endsWith(".png") ? "image/png" : "text/html" } }));
    await atlasService.enrichBookmark({ accountId, id: saved.id }); await waitForReady(saved.id);
    const next = atlasService.get({ accountId, id: saved.id })!;
    expect(next.bookmarkImagePath).not.toBe(previous);
    expect(fs.readFileSync(next.bookmarkImagePath!)).toHaveLength(5);
    expect(next.metadata?.bookmark?.imageUrl).toBe("https://example.com/new-cover.png");
  });
  it("keeps the bookmark after a fetch error and bounds automatic retries", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
    const item = await atlasService.saveBookmark({ accountId, url: "https://example.com/offline" });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(atlasService.get({ accountId, id: item.id })?.bookmarkState?.error).toBe("Offline"));
    expect(atlasService.get({ accountId, id: item.id })?.url).toBe(item.url);
    await atlasBookmarks.stop();
    const row = atlasRepo.find(item.id, accountId)!;
    atlasRepo.update(item.id, accountId, { bookmarkJob: JSON.stringify({ ...JSON.parse(row.bookmarkJob!), attempts: 2, nextAt: 0 }) });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(atlasService.get({ accountId, id: item.id })?.bookmarkState?.status).toBe("failed"));
    const calls = vi.mocked(fetch).mock.calls.length; await atlasBookmarks.drain(); expect(fetch).toHaveBeenCalledTimes(calls);
  });
  it("checks redirects and cancels an oversized response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/target" } }))
      .mockResolvedValueOnce(new Response("<html></html>", { headers: { "content-type": "text/html", "content-length": "3000000" } }));
    await expect(fetchBookmarkResource("https://example.com/start")).rejects.toThrow("limit");
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("https://example.com/target");
  });
  it("discards an old response when the URL is edited while metadata is loading", async () => {
    let oldResponse!: (value: Response) => void, newResponse!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { oldResponse = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { newResponse = resolve; }));
    const saved = await atlasService.saveBookmark({ accountId, url: "https://old.example.com" });
    atlasBookmarks.start(); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await atlasService.saveBookmark({ accountId, id: saved.id, url: "https://new.example.com" });
    oldResponse(new Response('<title>Old title</title>', { headers: { "content-type": "text/html" } }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(atlasService.get({ accountId, id: saved.id })?.title).toBe("new.example.com");
    newResponse(new Response('<title>New title</title>', { headers: { "content-type": "text/html" } }));
    await waitForReady(saved.id);
    expect(atlasService.get({ accountId, id: saved.id })?.title).toBe("New title");
  });
  it("keeps a missing model as a retryable error instead of substituting another model", async () => {
    await atlasService.setAutoTagging({ accountId, config: { enabled: true, providerId: "codex", model: "cheap" } });
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    ai.models.mockResolvedValue([]);
    atlasBookmarks.start();
    await vi.waitFor(() => expect(atlasService.get({ accountId, id: saved.id })?.bookmarkState?.error).toContain("selected tagging model"));
    expect(ai.generate).not.toHaveBeenCalled();
  });
  it("discards classification returned after automatic tagging is disabled", async () => {
    const config = { enabled: true, providerId: "codex", model: "cheap" };
    await atlasService.setAutoTagging({ accountId, config });
    let finish!: (value: string) => void;
    ai.generate.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com", tags: ["Research"] });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(ai.generate).toHaveBeenCalledTimes(1));
    await atlasService.setAutoTagging({ accountId, config: { ...config, enabled: false } });
    finish('{"tags":["Late classification"],"type":"article"}');
    await waitForReady(saved.id);
    const ready = atlasService.get({ accountId, id: saved.id })!;
    expect(ready.tags?.map((tag) => tag.name)).toEqual(["Research"]);
    expect(ready.bookmarkState?.analyzedBy).toBeUndefined();
  });
  it("fences restart during shutdown and resumes interrupted work without spending a retry", async () => {
    await atlasService.setAutoTagging({ accountId, config: { enabled: true, providerId: "codex", model: "cheap" } });
    let finish!: (value: string) => void;
    ai.generate.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(ai.generate).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = atlasBookmarks.stop().then(() => { closed = true; });
    atlasBookmarks.start();
    await atlasBookmarks.drain();
    expect(closed).toBe(false);
    finish('{"tags":["Retired result"],"type":"article"}');
    await closing;
    const interrupted = atlasRepo.find(saved.id, accountId)!;
    expect(JSON.parse(interrupted.bookmarkJob!)).toMatchObject({ status: "pending", attempts: 0 });
    expect(atlasService.get({ accountId, id: saved.id })?.tags).toEqual([]);
    atlasBookmarks.start();
    await waitForReady(saved.id);
    expect(ai.generate).toHaveBeenCalledTimes(2);
    expect(atlasService.get({ accountId, id: saved.id })?.tags?.some((tag) => tag.name === "Retired result")).toBe(false);
  });
  it("aborts the owned HTTP request before shutdown drains and leaves a resumable job", async () => {
    let signal!: AbortSignal, finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise<Response>((resolve, reject) => {
      finish = resolve; signal = options!.signal!;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const closing = atlasBookmarks.stop();
    try { expect(signal.aborted).toBe(true); }
    finally { finish(new Response("<title>Late</title>", { headers: { "content-type": "text/html" } })); await closing; }
    expect(atlasService.get({ accountId, id: saved.id })).toMatchObject({ title: "example.com", bookmarkState: { status: "pending" } });
    expect(JSON.parse(atlasRepo.find(saved.id, accountId)!.bookmarkJob!).attempts).toBe(0);
  });
  it("does not re-run a completed job through stale queue records or concurrent drains", async () => {
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    const queued = atlasRepo.find(saved.id, accountId)!;
    atlasBookmarks.start();
    await waitForReady(saved.id);
    const requests = vi.mocked(fetch).mock.calls.length;
    await Promise.all([atlasBookmarks.process(queued), atlasBookmarks.process(queued), atlasBookmarks.drain(), atlasBookmarks.drain()]);
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(JSON.parse(atlasRepo.find(saved.id, accountId)!.bookmarkJob!).attempts).toBe(1);
  });
  it("retires a download across Trash and restore even when the URL is unchanged", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(async () => new Response("<title>Fresh title</title>", { headers: { "content-type": "text/html" } }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await atlasService.update({ accountId, id: saved.id, trashed: true });
    await atlasService.update({ accountId, id: saved.id, trashed: false });
    finish(new Response("<title>Retired title</title>", { headers: { "content-type": "text/html" } }));
    await atlasBookmarks.drain();
    expect(atlasService.get({ accountId, id: saved.id })).toMatchObject({ title: "Fresh title", bookmarkState: { status: "ready" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rechecks opt-in after model discovery before invoking the model", async () => {
    const config = { enabled: true, providerId: "codex", model: "cheap" };
    await atlasService.setAutoTagging({ accountId, config });
    let finish!: (value: { id: string; displayName: string }[]) => void;
    ai.models.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(ai.models).toHaveBeenCalledTimes(2));
    await atlasService.setAutoTagging({ accountId, config: { ...config, enabled: false } });
    finish([{ id: "cheap", displayName: "Small model" }]);
    await atlasBookmarks.drain();
    expect(ai.generate).not.toHaveBeenCalled();
    expect(atlasService.get({ accountId, id: saved.id })?.bookmarkState?.status).toBe("ready");
  });
  it("does not revive an old analysis when automatic tagging is disabled and re-enabled", async () => {
    const config = { enabled: true, providerId: "codex", model: "cheap" };
    await atlasService.setAutoTagging({ accountId, config });
    let finish!: (value: string) => void;
    ai.generate.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(ai.generate).toHaveBeenCalledTimes(1));
    await atlasService.setAutoTagging({ accountId, config: { ...config, enabled: false } });
    await atlasService.setAutoTagging({ accountId, config });
    finish('{"tags":["Retired classification"],"type":"article"}');
    await atlasBookmarks.drain();
    expect(atlasService.get({ accountId, id: saved.id })?.tags).toEqual([]);
    await atlasService.enrichBookmark({ accountId, id: saved.id });
    await waitForReady(saved.id);
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });
  it("keeps a later opt-out when an older enable request finishes model validation", async () => {
    let finish!: (value: { id: string; displayName: string }[]) => void;
    ai.models.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const config = { enabled: true, providerId: "codex", model: "cheap" };
    const enabling = atlasService.setAutoTagging({ accountId, config });
    const outcome = enabling.then(() => "enabled", (error: Error) => error.message);
    await vi.waitFor(() => expect(ai.models).toHaveBeenCalledTimes(1));
    await atlasService.setAutoTagging({ accountId, config: { ...config, enabled: false } });
    finish([{ id: "cheap", displayName: "Small model" }]);
    expect(await outcome).toContain("superseded");
    expect(await atlasService.getAutoTagging({ accountId })).toMatchObject({ enabled: false });
  });
  it.each([false, true])("removes unpublished and older previews when deleted during a file write (cached: %s)", async (cached) => {
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    if (cached) {
      atlasBookmarks.start(); await waitForReady(saved.id); await atlasBookmarks.stop();
      vi.mocked(fetch).mockImplementation(async (url) => new Response(String(url).endsWith(".png") ? new Uint8Array([137, 80, 78, 71, 2]) : page.replace("/cover.png", "/new.png"),
        { headers: { "content-type": String(url).endsWith(".png") ? "image/png" : "text/html" } }));
      await atlasService.enrichBookmark({ accountId, id: saved.id });
    }
    let finish!: () => void, writing = false;
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    const rename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "rename").mockImplementationOnce(async (...args) => { await rename(...args); writing = true; await blocked; });
    atlasBookmarks.start();
    await vi.waitFor(() => expect(writing).toBe(true));
    try {
      await atlasService.update({ accountId, id: saved.id, trashed: true });
      await atlasService.remove({ accountId, id: saved.id });
    } finally { finish(); }
    await atlasBookmarks.drain();
    expect(atlasService.get({ accountId, id: saved.id })).toBeNull();
    expect(fs.existsSync(path.join(directory, "atlas", "files", saved.id))).toBe(false);
  });
  it("rolls AI tags back if their metadata checkpoint cannot be persisted", async () => {
    await atlasService.setAutoTagging({ accountId, config: { enabled: true, providerId: "codex", model: "cheap" } });
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com", tags: ["Research"] });
    db.run(sql`CREATE TRIGGER reject_bookmark_classification BEFORE UPDATE ON atlas_items
      WHEN json_extract(NEW.metadata, '$.bookmark.contentType') = 'documentation'
      BEGIN SELECT RAISE(ABORT, 'classification checkpoint failed'); END`);
    atlasBookmarks.start();
    await atlasBookmarks.drain();
    const failed = atlasService.get({ accountId, id: saved.id })!;
    expect(failed.bookmarkState).toMatchObject({ status: "pending", error: "classification checkpoint failed" });
    expect(failed.tags?.map((tag) => tag.name)).toEqual(["Research"]);
    expect(failed.metadata?.bookmark?.contentType).toBe("website");
    expect(JSON.parse(atlasRepo.find(saved.id, accountId)!.bookmarkJob!).fingerprint).toBeUndefined();
  });
  it("drains and retires settings preparation before releasing database ownership", async () => {
    let finish!: (value: { id: string; displayName: string }[]) => void;
    ai.models.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const preparing = atlasService.setAutoTagging({ accountId, config: { enabled: true, providerId: "codex", model: "cheap" } });
    const outcome = preparing.then(() => "enabled", (error: Error) => error.message);
    await vi.waitFor(() => expect(ai.models).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = atlasBookmarks.stop().then(() => { closed = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    try { expect(closed).toBe(false); }
    finally { finish([{ id: "cheap", displayName: "Small model" }]); await outcome; await closing; }
    expect(await outcome).toContain("stopping");
    expect(await atlasService.getAutoTagging({ accountId })).toMatchObject({ enabled: false });
  });
  it.each([["edit", "pending"], ["enrich", "pending"], ["edit", "ready"], ["enrich", "ready"],
    ["edit", "replica"], ["enrich", "replica"]] as const)("rejects %s prepared before a Trash/restore boundary (%s)", async (action, state) => {
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com", note: "Original note" });
    if (state === "ready") { atlasBookmarks.start(); await waitForReady(saved.id); await atlasBookmarks.stop(); }
    if (state === "replica") atlasRepo.update(saved.id, accountId, { bookmarkJob: null });
    let finish!: (value: { enabled: boolean; providerId: string; model: string }) => void;
    const preferences = vi.spyOn(atlasBookmarks, "preferences").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const preparing = action === "edit" ? atlasService.saveBookmark({ accountId, id: saved.id, url: saved.url!, note: "Stale note" })
      : atlasService.enrichBookmark({ accountId, id: saved.id });
    const outcome = preparing.then(() => "saved", (error: Error) => error.message);
    await vi.waitFor(() => expect(preferences).toHaveBeenCalledTimes(1));
    await atlasService.update({ accountId, id: saved.id, trashed: true });
    await atlasService.update({ accountId, id: saved.id, trashed: false });
    const job = atlasRepo.find(saved.id, accountId)!.bookmarkJob;
    finish({ enabled: false, providerId: "", model: "" });
    expect(await outcome).toContain("changed");
    expect(atlasRepo.find(saved.id, accountId)!.bookmarkJob).toBe(job);
    expect(atlasService.get({ accountId, id: saved.id })?.note).toBe("Original note");
  });
  it("does not let corrupt jobs or 50 backed-off jobs hide a due bookmark", async () => {
    const delayed = await atlasService.saveBookmark({ accountId, url: "https://example.com/delayed" });
    const job = { ...JSON.parse(atlasRepo.find(delayed.id, accountId)!.bookmarkJob!), nextAt: Date.now() + 60000 };
    atlasRepo.update(delayed.id, accountId, { bookmarkJob: JSON.stringify(job), updatedAt: new Date(0) });
    for (let index = 0; index < 49; index++) atlasRepo.insert({ id: `delayed-${index}`, accountId, kind: "bookmark", title: "Delayed",
      url: `https://example.com/delayed-${index}`, bookmarkJob: JSON.stringify({ ...job, id: `job-${index}` }), updatedAt: new Date(0) });
    for (let index = 0; index < 51; index++) atlasRepo.insert({ id: `corrupt-${index}`, accountId, kind: "bookmark", title: "Corrupt",
      url: `https://example.com/corrupt-${index}`, bookmarkJob: JSON.stringify({ status: "pending", nextAt: 0 }), updatedAt: new Date(0) });
    const due = await atlasService.saveBookmark({ accountId, url: "https://example.com/due" });
    atlasBookmarks.start();
    await atlasBookmarks.drain();
    expect(atlasService.get({ accountId, id: due.id })?.bookmarkState?.status).toBe("ready");
    expect(atlasService.get({ accountId, id: delayed.id })?.bookmarkState?.status).toBe("pending");
    expect(atlasService.get({ accountId, id: "corrupt-0" })?.bookmarkState).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves a later opt-out when an older settings write is already in flight", async () => {
    let finish!: () => void, writing = false;
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    const write = appSettingsService.updateAtlasAutoTagging.bind(appSettingsService);
    vi.spyOn(appSettingsService, "updateAtlasAutoTagging").mockImplementationOnce(async (config) => {
      writing = true; await blocked; return write(config);
    });
    const config = { enabled: true, providerId: "codex", model: "cheap" };
    const enabling = atlasService.setAutoTagging({ accountId, config });
    await vi.waitFor(() => expect(writing).toBe(true));
    const disabling = atlasService.setAutoTagging({ accountId, config: { ...config, enabled: false } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    finish(); await Promise.all([enabling, disabling]);
    expect(await atlasService.getAutoTagging({ accountId })).toMatchObject({ enabled: false });
  });
  it("keeps tagging policy changes behind the Atlas lifecycle instead of generic settings patches", async () => {
    await appSettingsService.updateSettings({ atlasAutoTagging: JSON.stringify({ enabled: true, providerId: "codex", model: "cheap" }) });
    expect(await atlasService.getAutoTagging({ accountId })).toMatchObject({ enabled: false });
    expect(ai.models).not.toHaveBeenCalled();
  });
  it("recovers an interrupted last attempt and resets its budget only on explicit enrichment", async () => {
    const saved = await atlasService.saveBookmark({ accountId, url: "https://example.com" });
    const previous = JSON.parse(atlasRepo.find(saved.id, accountId)!.bookmarkJob!);
    atlasRepo.update(saved.id, accountId, { bookmarkJob: JSON.stringify({ ...previous, status: "running", attempts: 3 }) });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Still unavailable"));
    atlasBookmarks.start(); await atlasBookmarks.drain();
    expect(JSON.parse(atlasRepo.find(saved.id, accountId)!.bookmarkJob!)).toMatchObject({ status: "failed", attempts: 3 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await atlasService.enrichBookmark({ accountId, id: saved.id });
    await waitForReady(saved.id);
    const recovered = JSON.parse(atlasRepo.find(saved.id, accountId)!.bookmarkJob!);
    expect(recovered.id).not.toBe(previous.id);
    expect(recovered).toMatchObject({ status: "ready", attempts: 1 });
  });
});
