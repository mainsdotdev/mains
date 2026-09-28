import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  browserPreviewUrl,
  requireHtmlPreviewPath,
  serveBrowserPreview,
} from "./browser-preview";

const tabId = "e365a3a2-4e67-40ef-9af0-57a5cf1d999b";
const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "mains-html-preview-"));
  directories.push(dir);
  const filePath = join(dir, "palette.html");
  writeFileSync(filePath, "<!doctype html><title>Palette</title><h1>Colors</h1>");
  return { dir, filePath };
}

describe("browser HTML preview", () => {
  it("serves a selected HTML file with isolated page permissions", async () => {
    const { filePath } = fixture();
    const response = serveBrowserPreview(
      new URL(browserPreviewUrl(tabId)),
      (requestedTabId) => requestedTabId === tabId ? filePath : null,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<h1>Colors</h1>");
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(response.headers.get("Content-Security-Policy")).toContain("object-src 'none'");
  });

  it("rejects another tab, subresources, non-HTML files, and symlinks", () => {
    const { dir, filePath } = fixture();
    expect(serveBrowserPreview(new URL(browserPreviewUrl(tabId)), () => null).status).toBe(404);
    expect(serveBrowserPreview(new URL(`${browserPreviewUrl(tabId)}secret.txt`), () => filePath).status).toBe(400);
    const textFile = join(dir, "secret.txt");
    writeFileSync(textFile, "secret");
    expect(() => requireHtmlPreviewPath(textFile)).toThrow(".html and .htm");
    const symlink = join(dir, "linked.html");
    symlinkSync(filePath, symlink);
    expect(() => requireHtmlPreviewPath(symlink)).toThrow("regular file");
  });
});
