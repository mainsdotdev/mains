import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPathInsideDirectory,
  nextDownloadPath,
  safeDownloadFileName,
} from "./browser-downloads";

describe("safeDownloadFileName", () => {
  it("drops path traversal and control characters", () => {
    expect(safeDownloadFileName("../../report\u0000.pdf")).toBe("report.pdf");
    expect(safeDownloadFileName("..\\..\\archive.zip")).toBe("archive.zip");
  });

  it("uses a stable fallback for an empty name", () => {
    expect(safeDownloadFileName("\u0000")).toBe("download");
  });
});

describe("nextDownloadPath", () => {
  it("keeps the proposed name when it is available", () => {
    expect(nextDownloadPath("/tmp/downloads", "report.pdf", () => false)).toBe(
      path.join("/tmp/downloads", "report.pdf"),
    );
  });

  it("adds a numeric suffix without losing the extension", () => {
    const unavailable = new Set([
      path.join("/tmp/downloads", "report.pdf"),
      path.join("/tmp/downloads", "report (1).pdf"),
    ]);
    expect(
      nextDownloadPath("/tmp/downloads", "report.pdf", (candidate) =>
        unavailable.has(candidate),
      ),
    ).toBe(path.join("/tmp/downloads", "report (2).pdf"));
  });
});

describe("isPathInsideDirectory", () => {
  it("accepts descendants and rejects siblings or the directory itself", () => {
    expect(
      isPathInsideDirectory("/tmp/downloads", "/tmp/downloads/file.zip"),
    ).toBe(true);
    expect(
      isPathInsideDirectory("/tmp/downloads", "/tmp/downloads-old/file.zip"),
    ).toBe(false);
    expect(isPathInsideDirectory("/tmp/downloads", "/tmp/downloads")).toBe(
      false,
    );
  });
});
