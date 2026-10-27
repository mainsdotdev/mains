import { describe, expect, it } from "vitest";
import { ATLAS_COVER_PRESETS } from "@mains/contracts/atlas-covers";
import { coverThumbnail, coverTitle } from "./cover-thumbnails";

describe("Atlas cover gallery thumbnails", () => {
  it("has a thumbnail for every bundled cover", () => {
    // Run `npm run atlas:cover-thumbnails` after adding a cover to the catalog.
    const missing = ATLAS_COVER_PRESETS.map((cover) => cover.id).filter((id) => !coverThumbnail(id));
    expect(missing).toEqual([]);
  });
  it("titles a cover from its id", () => {
    expect(coverTitle("aurora")).toBe("Aurora");
    expect(coverTitle("deep-sea")).toBe("Deep sea");
  });
});
