import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ATLAS_COVER_GROUPS, ATLAS_COVER_PRESETS, isCoverId } from "@mains/contracts/atlas-covers";
import { installTestBackendRuntime } from "../../../test/backend-runtime";
import { readCoverPreset } from "./atlas.covers";

const directory = path.resolve(__dirname, "../../../assets/atlas-covers");

describe("bundled Atlas covers", () => {
  let restoreRuntime: () => void;
  beforeEach(() => { restoreRuntime = installTestBackendRuntime(); });
  afterEach(() => restoreRuntime());
  it("has a unique, described, installed image for every catalog entry", async () => {
    const ids = ATLAS_COVER_PRESETS.map((cover) => cover.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cover of ATLAS_COVER_PRESETS) {
      expect(cover.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(cover.description.length).toBeGreaterThan(20);
      expect(ATLAS_COVER_GROUPS.map((group) => group.id)).toContain(cover.group);
      const bytes = await readCoverPreset(cover.id);
      const signature = bytes.subarray(0, 8).toString("hex");
      expect(cover.file).toBe(`${cover.id}.${cover.file.endsWith(".png") ? "png" : "jpg"}`);
      expect(cover.file.endsWith(".png") ? signature : signature.slice(0, 6))
        .toBe(cover.file.endsWith(".png") ? "89504e470d0a1a0a" : "ffd8ff");
      // Atlas shares covers across devices, so keep each one small.
      expect(bytes.length).toBeLessThan(1024 * 1024);
    }
  });
  it("ships no image that is missing from the catalog", () => {
    const files = fs.readdirSync(directory).filter((name) => !name.startsWith("."));
    expect(files.sort()).toEqual(ATLAS_COVER_PRESETS.map((cover) => cover.file).sort());
  });
  it("never resolves an id outside the catalog", async () => {
    expect(isCoverId("../../etc/passwd")).toBe(false);
    await expect(readCoverPreset("../slate")).rejects.toThrow("Unknown cover");
  });
});
