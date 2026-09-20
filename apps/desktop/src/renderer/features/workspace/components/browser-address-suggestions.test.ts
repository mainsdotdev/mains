import { describe, expect, it } from "vitest";
import type { BrowserHistoryEntryViewModel } from "./browser-history-panel";
import { browserAddressSuggestions } from "./browser-address-suggestions";

function historyEntry(
  overrides: Partial<BrowserHistoryEntryViewModel> &
    Pick<BrowserHistoryEntryViewModel, "id" | "url">,
): BrowserHistoryEntryViewModel {
  return {
    title: overrides.url,
    faviconUrl: null,
    visitedAt: "2026-09-17T10:00:00.000Z",
    visitCount: 1,
    ...overrides,
  };
}

describe("browserAddressSuggestions", () => {
  const entries = [
    historyEntry({
      id: "docs",
      url: "https://docs.example.com/guides/browser",
      title: "Browser guide",
      visitCount: 3,
    }),
    historyEntry({
      id: "apple",
      url: "https://appstoreconnect.apple.com/apps",
      title: "App Store Connect",
      visitCount: 4,
    }),
    historyEntry({
      id: "mains",
      url: "https://mains.dev/",
      title: "Mains",
      visitCount: 2,
    }),
  ];

  it("matches both page titles and visible URLs", () => {
    expect(browserAddressSuggestions(entries, "app")).toMatchObject([
      {
        id: "apple",
        displayUrl: "appstoreconnect.apple.com/apps",
      },
    ]);
    expect(browserAddressSuggestions(entries, "guide")[0]?.id).toBe("docs");
  });

  it("ranks a host prefix ahead of a title substring", () => {
    const results = browserAddressSuggestions(
      [
        historyEntry({
          id: "title-match",
          url: "https://example.com/",
          title: "The Mains handbook",
          visitCount: 20,
        }),
        historyEntry({
          id: "host-prefix",
          url: "https://mains.dev/",
          title: "Product",
        }),
      ],
      "mains",
    );

    expect(results.map((entry) => entry.id)).toEqual([
      "host-prefix",
      "title-match",
    ]);
  });

  it("deduplicates URLs and respects the result limit", () => {
    const results = browserAddressSuggestions(
      [
        entries[0],
        historyEntry({
          id: "docs-older",
          url: entries[0].url,
          title: "Older title",
          visitedAt: "2026-09-16T10:00:00.000Z",
          visitCount: 99,
        }),
        entries[1],
        entries[2],
      ],
      "",
      2,
    );

    expect(results).toHaveLength(2);
    expect(new Set(results.map((entry) => entry.url)).size).toBe(2);
    expect(results.find((entry) => entry.url === entries[0].url)?.id).toBe(
      "docs",
    );
  });

  it("returns no entries when the query has no history match", () => {
    expect(browserAddressSuggestions(entries, "not-in-history")).toEqual([]);
  });
});
