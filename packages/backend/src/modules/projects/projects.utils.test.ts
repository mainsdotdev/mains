import { describe, it, expect } from "vitest";
import { normalizeRemoteOrigin } from "./projects.utils";

describe("normalizeRemoteOrigin", () => {
  it("normalizes SSH format (git@host:owner/repo.git)", () => {
    expect(normalizeRemoteOrigin("git@github.com:Foo/bar.git")).toBe(
      "github.com/Foo/bar",
    );
  });

  it("normalizes HTTPS format with .git suffix", () => {
    expect(normalizeRemoteOrigin("https://github.com/Foo/bar.git")).toBe(
      "github.com/Foo/bar",
    );
  });

  it("normalizes HTTPS format without .git suffix", () => {
    expect(normalizeRemoteOrigin("https://github.com/Foo/bar")).toBe(
      "github.com/Foo/bar",
    );
  });

  it("normalizes SSH URL format (ssh://git@host/owner/repo)", () => {
    expect(normalizeRemoteOrigin("ssh://git@github.com/Foo/bar")).toBe(
      "github.com/Foo/bar",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeRemoteOrigin("  https://github.com/Foo/bar.git  ")).toBe(
      "github.com/Foo/bar",
    );
  });

  it("returns as-is for unparseable input", () => {
    expect(normalizeRemoteOrigin("not-a-url")).toBe("not-a-url");
  });
});
