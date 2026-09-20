import { describe, expect, it } from "vitest";
import { matchesSearch } from "./match-search";

describe("matchesSearch", () => {
  it("matches everything on a blank query", () => {
    expect(matchesSearch("", "anything")).toBe(true);
    expect(matchesSearch("   ", null)).toBe(true);
  });

  it("requires every term, in any field, in any order", () => {
    const fields = ["Weekly engineering update", "Narrative of the week"];
    expect(matchesSearch("week narrative", ...fields)).toBe(true);
    expect(matchesSearch("ENGINEERING", ...fields)).toBe(true);
    expect(matchesSearch("weekly release", ...fields)).toBe(false);
  });

  it("ignores missing fields", () => {
    expect(matchesSearch("digest", undefined, "Daily standup digest", null)).toBe(true);
  });
});
