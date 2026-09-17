import { describe, expect, it } from "vitest";
import type { BrowserHistoryEntry } from "./browser.dto";
import {
  addBrowserHistoryVisit,
  isTrackableBrowserHistoryUrl,
  normalizedBrowserHistoryEntry,
  updateBrowserHistoryMetadata,
} from "./browser-history";

function entry(
  id: string,
  url: string,
  visitedAt = "2026-09-17T08:00:00.000Z",
): BrowserHistoryEntry {
  return {
    id,
    url,
    title: url,
    faviconUrl: null,
    visitedAt,
    visitCount: 1,
  };
}

describe("isTrackableBrowserHistoryUrl", () => {
  it("tracks web pages but excludes internal and malformed URLs", () => {
    expect(isTrackableBrowserHistoryUrl("https://example.com")).toBe(true);
    expect(isTrackableBrowserHistoryUrl("http://localhost:3000")).toBe(true);
    expect(isTrackableBrowserHistoryUrl("about:blank")).toBe(false);
    expect(isTrackableBrowserHistoryUrl("chrome-error://chromewebdata/")).toBe(
      false,
    );
    expect(isTrackableBrowserHistoryUrl("not a url")).toBe(false);
  });
});

describe("normalizedBrowserHistoryEntry", () => {
  it("sanitizes persisted values and rejects invalid records", () => {
    expect(
      normalizedBrowserHistoryEntry({
        ...entry("one", "https://example.com"),
        title: "  Example  ",
        faviconUrl: "data:image/png;base64,unsafe",
        visitCount: -3,
      }),
    ).toEqual({
      ...entry("one", "https://example.com"),
      title: "Example",
    });
    expect(
      normalizedBrowserHistoryEntry(entry("blank", "about:blank")),
    ).toBeNull();
  });
});

describe("addBrowserHistoryVisit", () => {
  it("merges consecutive visits but preserves separated revisits", () => {
    const first = entry("one", "https://example.com");
    const repeat = entry(
      "two",
      "https://example.com",
      "2026-09-17T08:01:00.000Z",
    );
    const merged = addBrowserHistoryVisit([first], repeat);
    expect(merged).toEqual([
      {
        ...first,
        visitedAt: repeat.visitedAt,
        visitCount: 2,
      },
    ]);

    const other = entry("three", "https://openai.com");
    expect(addBrowserHistoryVisit([other, ...merged], repeat)).toHaveLength(3);
  });

  it("caps the persisted history", () => {
    expect(
      addBrowserHistoryVisit(
        [entry("one", "https://one.test")],
        entry("two", "https://two.test"),
        1,
      ),
    ).toEqual([entry("two", "https://two.test")]);
  });
});

describe("updateBrowserHistoryMetadata", () => {
  it("updates the newest matching visit without changing its visit time", () => {
    const original = entry("one", "https://example.com");
    expect(
      updateBrowserHistoryMetadata([original], original.url, {
        title: "Example",
        faviconUrl: "https://example.com/favicon.ico",
      }),
    ).toEqual([
      {
        ...original,
        title: "Example",
        faviconUrl: "https://example.com/favicon.ico",
      },
    ]);
  });
});
