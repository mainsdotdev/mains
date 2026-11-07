import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "../../../test/setup-db";
import { createAccount } from "../../../test/factories";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import type { DatabaseInstance } from "../../db/types";
import { atlasRepo } from "./atlas.repo";
import { atlasService } from "./atlas.service";
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
afterEach(async () => { await atlasBookmarks.stop(); cleanup(); restore(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); });

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
});
