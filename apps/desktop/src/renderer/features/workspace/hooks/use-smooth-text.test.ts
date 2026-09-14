import { describe, expect, it } from "vitest";
import { advanceReveal } from "./use-smooth-text";

describe("advanceReveal", () => {
  it("returns displayed unchanged when already caught up", () => {
    expect(advanceReveal("hello", "hello")).toBe("hello");
    expect(advanceReveal("", "")).toBe("");
  });

  it("advances by ceil(backlog / 10) characters per step", () => {
    const target = "a".repeat(100);
    // backlog 100 → step 10
    expect(advanceReveal(target, "")).toBe("a".repeat(10));
    // backlog 5 → step 1
    expect(advanceReveal(target, target.slice(0, 95))).toBe(
      target.slice(0, 96),
    );
  });

  it("always advances at least one character", () => {
    expect(advanceReveal("ab", "a")).toBe("ab");
  });

  it("drains a burst completely over successive steps", () => {
    const target = "streamed content that arrived as one bursty chunk";
    let displayed = "";
    let steps = 0;
    while (displayed !== target) {
      displayed = advanceReveal(target, displayed);
      steps++;
      expect(steps).toBeLessThan(100);
    }
    expect(steps).toBeGreaterThan(1);
  });

  it("snaps to target when displayed is not a prefix (stream reset)", () => {
    expect(advanceReveal("fresh content", "old different text")).toBe(
      "fresh content",
    );
    expect(advanceReveal("", "leftover")).toBe("");
  });

  it("never splits a surrogate pair", () => {
    // 9 plain chars then an emoji: backlog 11 → step 2 would cut the
    // emoji's surrogate pair in half; the step must extend past it.
    const target = "abcdefghi\u{1F600}";
    let displayed = "";
    while (displayed !== target) {
      displayed = advanceReveal(target, displayed);
      const last = displayed.charCodeAt(displayed.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(displayed).toBe(target);
  });

  it("treats appended chunks as append-only prefixes", () => {
    let displayed = advanceReveal("hel", "");
    displayed = advanceReveal("hel", displayed);
    displayed = advanceReveal("hel", displayed);
    expect(displayed).toBe("hel");
    // new chunk arrives
    displayed = advanceReveal("hello world", displayed);
    expect(displayed.startsWith("hel")).toBe(true);
    expect(displayed.length).toBeGreaterThan(3);
  });
});
