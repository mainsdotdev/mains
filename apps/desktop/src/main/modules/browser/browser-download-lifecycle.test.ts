import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "electron";

const native = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({
  app: { getPath: (kind: string) => kind === "downloads" ? join(native.root, "Downloads") : native.root, isPackaged: false },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  clipboard: {}, Menu: {}, shell: {}, WebContentsView: class {},
}));
vi.mock("../keyboardShortcuts", () => ({ keyboardShortcutsService: { getBinding: () => null } }));
import { browserService } from "./browser.service";

let session: EventEmitter;
beforeEach(() => {
  vi.useFakeTimers();
  native.root = mkdtempSync(join(tmpdir(), "mains-browser-download-lifecycle-"));
  mkdirSync(join(native.root, "Downloads"));
  browserService.downloadsLoaded = false;
  browserService.downloads.clear(); browserService.activeDownloadItems.clear();
  browserService.downloadLifecycles.clear();
  browserService.reservedDownloadPaths.clear(); browserService.recentDownloadUrls.clear();
  browserService.sessionConfigured = false;
  session = Object.assign(new EventEmitter(), {
    setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
  });
  browserService._configureSession(session as Session);
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  browserService.downloadPersistTimer = null;
  browserService.downloads.clear(); browserService.activeDownloadItems.clear(); browserService.reservedDownloadPaths.clear();
  browserService.downloadLifecycles.clear();
  rmSync(native.root, { recursive: true, force: true });
});
function download() {
  const known = new Set(browserService.getDownloads().map((row) => row.id));
  let savePath = "";
  const item = Object.assign(new EventEmitter(), {
    getFilename: () => "report.pdf", getURL: () => "https://example.test/report.pdf",
    getURLChain: () => ["https://example.test/report.pdf"], getMimeType: () => "application/pdf", getStartTime: () => 0,
    getReceivedBytes: vi.fn(() => 10), getTotalBytes: vi.fn(() => 100), getCurrentBytesPerSecond: vi.fn(() => 20),
    isPaused: vi.fn(() => false), setSavePath: (value: string) => { savePath = value; }, getSavePath: () => savePath,
    cancel: vi.fn(),
  });
  session.emit("will-download", {}, item, { id: 41 });
  const row = browserService.getDownloads().find((entry) => !known.has(entry.id))!;
  return { item, row };
}

it("keeps a completed download terminal when a delayed progress update arrives", () => {
  const { item, row } = download();
  item.getReceivedBytes.mockReturnValue(100);
  item.emit("done", {}, "completed");
  item.getReceivedBytes.mockReturnValue(5);
  item.emit("updated", {}, "progressing");
  expect(browserService.getDownloads()[0]).toMatchObject({ id: row.id, state: "completed", receivedBytes: 100, speedBytesPerSecond: 0 });
});

it("preserves an authoritative completion emitted synchronously during Cancel", () => {
  const { item, row } = download();
  item.cancel.mockImplementationOnce(() => { item.getReceivedBytes.mockReturnValue(100); item.emit("done", {}, "completed"); });
  expect(browserService.cancelDownload(row.id)[0]).toMatchObject({ state: "completed", receivedBytes: 100 });
  expect(item.listenerCount("updated")).toBe(0);
  expect(browserService.reservedDownloadPaths.size).toBe(0);
});

it("keeps cancellation pending through late progress and clears only after the native receipt", () => {
  const { item, row } = download();
  browserService.cancelDownload(row.id);
  browserService.cancelDownload(row.id);
  item.emit("updated", {}, "progressing");
  expect(browserService.getDownloads()[0].state).toBe("cancelled");
  expect(item.cancel).toHaveBeenCalledOnce();
  expect(browserService.clearDownloads()).toHaveLength(1);
  expect(browserService.reservedDownloadPaths.has(row.savePath)).toBe(true);
  item.emit("done", {}, "cancelled");
  expect(browserService.clearDownloads()).toEqual([]);
  expect(browserService.reservedDownloadPaths.size).toBe(0);
});

it("restores a rejected cancellation and allows an explicit retry", () => {
  const { item, row } = download();
  item.cancel.mockImplementationOnce(() => { throw new Error("Native cancellation failed"); });
  expect(() => browserService.cancelDownload(row.id)).toThrow("Native cancellation failed");
  expect(browserService.getDownloads()[0]).toMatchObject({ state: "progressing", speedBytesPerSecond: 20 });
  browserService.cancelDownload(row.id);
  item.emit("done", {}, "cancelled");
  expect(browserService.getDownloads()[0].state).toBe("cancelled");
  expect(item.cancel).toHaveBeenCalledTimes(2);
});

it("allows a paused or interrupted native transfer to resume before its terminal receipt", () => {
  const { item, row } = download();
  item.isPaused.mockReturnValue(true); item.emit("updated", {}, "progressing");
  expect(browserService.getDownloads()[0].state).toBe("paused");
  item.isPaused.mockReturnValue(false); item.emit("updated", {}, "interrupted");
  expect(browserService.getDownloads()[0].state).toBe("interrupted");
  expect(browserService.activeDownloadItems.get(row.id)).toBe(item);
  item.emit("updated", {}, "progressing");
  expect(browserService.getDownloads()[0].state).toBe("progressing");
  item.emit("done", {}, "completed"); item.emit("done", {}, "interrupted");
  expect(browserService.getDownloads()[0].state).toBe("completed");
});

it("restores unfinished persisted transfers as interrupted without a native cancellation handle", () => {
  const { item, row } = download(); item.emit("done", {}, "cancelled");
  writeFileSync(join(native.root, "browser-downloads.json"), JSON.stringify({ version: 1, downloads: [
    { ...row, id: "unfinished", state: "progressing", speedBytesPerSecond: 99 },
    { ...row, id: "paused", state: "paused" },
    { ...row, id: "invalid", state: "completed", savePath: join(native.root, "outside.pdf") },
  ] }));
  browserService.downloads.clear(); browserService.downloadsLoaded = false;
  expect(browserService.getDownloads()).toEqual([
    expect.objectContaining({ id: "unfinished", state: "interrupted", speedBytesPerSecond: 0 }),
    expect.objectContaining({ id: "paused", state: "interrupted", speedBytesPerSecond: 0 }),
  ]);
  expect(() => browserService.cancelDownload("unfinished")).toThrow("no longer active");
});

it("reserves independent paths and ignores an old terminal event after the path is reused", () => {
  const first = download(), second = download();
  expect(second.row.fileName).toBe("report (1).pdf");
  first.item.emit("done", {}, "cancelled");
  const replacement = download();
  expect(replacement.row.savePath).toBe(first.row.savePath);
  first.item.emit("done", {}, "completed");
  expect(browserService.reservedDownloadPaths.has(replacement.row.savePath)).toBe(true);
  expect(browserService.getDownloads().find((row) => row.id === replacement.row.id)?.state).toBe("progressing");
});
