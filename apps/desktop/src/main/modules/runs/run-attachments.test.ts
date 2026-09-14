import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachmentFileName, sanitizeRunAttachments } from "./run-attachments";

// Real temporary directories: the guarantees are about how paths resolve on
// disk (`..`, symlinks), which a mocked fs cannot show.
let root: string;
let captureDir: string;
let outside: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mains-attach-")));
  captureDir = path.join(root, "userData", "browser-captures");
  fs.mkdirSync(captureDir, { recursive: true });
  outside = path.join(root, "secret.txt");
  fs.writeFileSync(outside, "secret");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const image = (extra: Record<string, unknown> = {}) => ({
  name: "shot.png",
  type: "image",
  mimeType: "image/png",
  ...extra,
});

describe("attachmentFileName", () => {
  it("keeps a plain filename", () => {
    expect(attachmentFileName("report.pdf")).toBe("report.pdf");
  });

  it("drops every directory segment, whichever separator", () => {
    expect(attachmentFileName("../../../Users/me/.zshrc")).toBe(".zshrc");
    expect(attachmentFileName("..\\..\\evil.png")).toBe("evil.png");
    expect(attachmentFileName("/etc/passwd")).toBe("passwd");
  });

  it("falls back when nothing usable is left", () => {
    expect(attachmentFileName("..")).toBe("attachment");
    expect(attachmentFileName("../")).toBe("attachment");
    expect(attachmentFileName("  ")).toBe("attachment");
  });
});

describe("sanitizeRunAttachments", () => {
  it("passes an absent list through", () => {
    expect(sanitizeRunAttachments(undefined, captureDir)).toBeUndefined();
    expect(sanitizeRunAttachments(null, captureDir)).toBeUndefined();
  });

  it("rejects a malformed list or item", () => {
    expect(() => sanitizeRunAttachments("nope", captureDir)).toThrow("must be a list");
    expect(() => sanitizeRunAttachments([null], captureDir)).toThrow("Invalid attachment");
    expect(() => sanitizeRunAttachments([image({ type: "script" })], captureDir)).toThrow(
      "Unsupported attachment type",
    );
    expect(() => sanitizeRunAttachments([image({ data: 42 })], captureDir)).toThrow(
      "base64 text",
    );
  });

  it("reduces a traversing name to its filename", () => {
    const [out] = sanitizeRunAttachments(
      [{ name: "../../../../Users/me/.zshrc", type: "document", mimeType: "text/plain", data: "eA==" }],
      captureDir,
    )!;
    expect(out).toEqual({ name: ".zshrc", type: "document", mimeType: "text/plain", data: "eA==" });
  });

  it("keeps a source inside the browser-captures directory", () => {
    const shot = path.join(captureDir, "shot.png");
    fs.writeFileSync(shot, "png");
    const [out] = sanitizeRunAttachments([image({ sourcePath: shot })], captureDir)!;
    expect(out.sourcePath).toBe(shot);
  });

  it("keeps an evicted capture so the adapter can skip it as before", () => {
    const gone = path.join(captureDir, "evicted.png");
    const [out] = sanitizeRunAttachments([image({ sourcePath: gone })], captureDir)!;
    expect(out.sourcePath).toBe(gone);
  });

  it("refuses a source outside the captures directory", () => {
    expect(() => sanitizeRunAttachments([image({ sourcePath: outside })], captureDir)).toThrow(
      "browser capture",
    );
  });

  it("refuses a source that climbs out with ..", () => {
    const climbing = path.join(captureDir, "..", "..", "secret.txt");
    expect(() => sanitizeRunAttachments([image({ sourcePath: climbing })], captureDir)).toThrow(
      "browser capture",
    );
  });

  it("refuses a symlink inside the directory that points outside it", () => {
    const link = path.join(captureDir, "link.png");
    fs.symlinkSync(outside, link);
    expect(() => sanitizeRunAttachments([image({ sourcePath: link })], captureDir)).toThrow(
      "browser capture",
    );
  });

  it("refuses the captures directory itself", () => {
    expect(() => sanitizeRunAttachments([image({ sourcePath: captureDir })], captureDir)).toThrow(
      "browser capture",
    );
  });

  it("refuses a source on a document — only screenshots come from disk", () => {
    const shot = path.join(captureDir, "notes.txt");
    fs.writeFileSync(shot, "text");
    expect(() =>
      sanitizeRunAttachments(
        [{ name: "notes.txt", type: "document", mimeType: "text/plain", sourcePath: shot }],
        captureDir,
      ),
    ).toThrow("browser capture");
  });
});
