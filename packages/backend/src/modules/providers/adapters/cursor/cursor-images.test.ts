import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OUTPUT_FILE_MAX_BYTES } from "@mains/contracts/output-files";
import { installTestBackendRuntime } from "../../../../../test/backend-runtime";
import { captureCursorImage } from "./cursor-images";

describe("Cursor generated image capture", () => {
  let temporary: string, cwd: string;
  let restore: () => void;
  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mains-cursor-image-"));
    cwd = path.join(temporary, "workspace");
    fs.mkdirSync(cwd);
    restore = installTestBackendRuntime({ getPath: () => path.join(temporary, "data") });
    vi.spyOn(os, "homedir").mockReturnValue(path.join(temporary, "home"));
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); fs.rmSync(temporary, { recursive: true, force: true }); });

  it("keeps delivered bytes when Cursor reuses its output filename", async () => {
    const source = path.join(cwd, "flag.png");
    fs.writeFileSync(source, "first image");
    const first = await captureCursorImage("run", cwd, { filePath: source });
    const duplicate = await captureCursorImage("run", cwd, { filePath: source });
    fs.writeFileSync(source, "second image");
    const second = await captureCursorImage("run", cwd, { filePath: source });
    if (first?.type !== "artifact" || duplicate?.type !== "artifact" || second?.type !== "artifact") throw new Error("Missing image");
    expect(duplicate.path).toBe(first.path);
    expect(second.path).not.toBe(first.path);
    expect(fs.readFileSync(first.path!, "utf8")).toBe("first image");
    expect(fs.readFileSync(second.path!, "utf8")).toBe("second image");
  });

  it.each(["missing", "symlink", "other-project", "directory", "oversize", "non-image"])("does not deliver %s files", async (kind) => {
    let source = path.join(cwd, "image.png");
    if (kind === "other-project") {
      source = path.join(os.homedir(), ".cursor", "projects", "other-workspace", "assets", "image.png");
      fs.mkdirSync(path.dirname(source), { recursive: true });
    }
    if (kind === "non-image") source = path.join(cwd, "secret.txt");
    if (kind === "directory") fs.mkdirSync(source);
    else if (kind === "symlink") {
      const target = path.join(cwd, "target.png");
      fs.writeFileSync(target, "image"); fs.symlinkSync(target, source);
    } else if (kind !== "missing") fs.writeFileSync(source, "image");
    if (kind === "oversize") fs.truncateSync(source, OUTPUT_FILE_MAX_BYTES + 1);
    expect(await captureCursorImage("run", cwd, { filePath: source })).toMatchObject({ type: "log", level: "warn" });
    expect(fs.existsSync(path.join(temporary, "data", "generated-images"))).toBe(false);
  });

  it("never treats reference images as generated output", async () => {
    const reference = path.join(cwd, "reference.png");
    fs.writeFileSync(reference, "reference");
    expect(await captureCursorImage("run", cwd, { referenceImagePaths: [reference] })).toBeNull();
  });
});
