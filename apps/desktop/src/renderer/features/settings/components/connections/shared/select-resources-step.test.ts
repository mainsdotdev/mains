import { describe, expect, it } from "vitest";
import { matchesResourceQuery } from "./select-resources-step";

describe("matchesResourceQuery", () => {
  it("matches case-insensitive substrings", () => {
    expect(matchesResourceQuery("mainsdotdev/mains", "MAINS")).toBe(true);
    expect(matchesResourceQuery("mainsdotdev/mains", "website")).toBe(false);
  });

  it("requires every token, in any order", () => {
    // The point of tokens: the user shouldn't have to type the `/` the
    // provider happens to put between owner and repo.
    expect(matchesResourceQuery("mainsdotdev/website", "dev website")).toBe(true);
    expect(matchesResourceQuery("mainsdotdev/website", "website dev")).toBe(true);
    expect(matchesResourceQuery("mainsdotdev/website", "dev mains og")).toBe(false);
  });

  it("treats an empty or whitespace-only query as no filter", () => {
    expect(matchesResourceQuery("OkanBilal/life", "")).toBe(true);
    expect(matchesResourceQuery("OkanBilal/life", "   ")).toBe(true);
  });

  it("searches the secondary label the row renders, not just the identity", () => {
    // Jira hands back name + key; both are on screen, so both must match.
    expect(matchesResourceQuery("Platform Team PLAT", "plat")).toBe(true);
    expect(matchesResourceQuery("Platform Team PLAT", "team")).toBe(true);
  });
});
