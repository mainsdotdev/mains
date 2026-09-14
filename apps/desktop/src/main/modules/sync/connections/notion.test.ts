import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so env vars are set before module-level const capture
vi.hoisted(() => {
  process.env.NOTION_TOKEN = "test-notion-token";
  process.env.NOTION_VERSION = "2022-06-28";
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  fetchNotionDatabaseItems,
  fetchNotionBookmarkBlocks,
} from "./notion";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────
// fetchNotionDatabaseItems
// ─────────────────────────────────────────────────────────────
describe("fetchNotionDatabaseItems", () => {
  it("returns [] when API responds with non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    const result = await fetchNotionDatabaseItems("db-1");
    expect(result).toEqual([]);
  });

  it("maps page to EntityInput with default props", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: "page-1",
              url: "https://notion.so/page-1",
              created_time: "2024-01-15T10:00:00Z",
              cover: null,
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: "My Page" }],
                },
                URL: {
                  type: "url",
                  url: "https://example.com",
                },
                Date: {
                  type: "date",
                  date: { start: "2024-01-15" },
                },
                Description: {
                  type: "rich_text",
                  rich_text: [{ plain_text: "A description" }],
                },
                Image: {
                  type: "files",
                  files: [
                    {
                      type: "external",
                      external: { url: "https://img.example.com/pic.png" },
                    },
                  ],
                },
                Tags: {
                  type: "multi_select",
                  multi_select: [{ name: "dev" }, { name: "docs" }],
                },
              },
            },
          ],
        }),
    });

    const result = await fetchNotionDatabaseItems("db-1");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("notion_page");
    expect(result[0].title).toBe("My Page");
    expect(result[0].url).toBe("https://example.com");
    expect(result[0].body).toBe("A description");
    expect(result[0].summary).toBe("A description");
    expect(result[0].occurredAt).toBe("2024-01-15");
    expect(result[0].externalId).toBe("page-1");
    expect(result[0].connectionId).toBeNull();
    expect(result[0].resourceId).toBeNull();

    const meta = result[0].metadata as Record<string, unknown>;
    expect(meta.tags).toEqual(["dev", "docs"]);
    expect(meta.imageUrl).toBe("https://img.example.com/pic.png");
    const notion = meta.notion as Record<string, unknown>;
    expect(notion.page_id).toBe("page-1");
    expect(notion.database_id).toBe("db-1");
  });

  it("uses custom prop mapping", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: "page-2",
              url: "https://notion.so/page-2",
              created_time: "2024-03-01T00:00:00Z",
              cover: null,
              properties: {
                Title: {
                  type: "title",
                  title: [{ plain_text: "Custom Title" }],
                },
                Link: {
                  type: "url",
                  url: "https://custom.example.com",
                },
                Created: {
                  type: "date",
                  date: { start: "2024-03-01" },
                },
                Summary: {
                  type: "rich_text",
                  rich_text: [{ plain_text: "Custom summary" }],
                },
                Cover: {
                  type: "files",
                  files: [],
                },
              },
            },
          ],
        }),
    });

    const result = await fetchNotionDatabaseItems("db-2", {
      titleProp: "Title",
      urlProp: "Link",
      dateProp: "Created",
      descriptionProp: "Summary",
      imageProp: "Cover",
      connectionId: "conn-1",
      resourceId: "res-1",
    });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Custom Title");
    expect(result[0].url).toBe("https://custom.example.com");
    expect(result[0].body).toBe("Custom summary");
    expect(result[0].connectionId).toBe("conn-1");
    expect(result[0].resourceId).toBe("res-1");
  });

  it("returns [] when API throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchNotionDatabaseItems("db-1");
    expect(result).toEqual([]);
  });

  it("returns [] when results array is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    const result = await fetchNotionDatabaseItems("db-1");
    expect(result).toEqual([]);
  });

  it("sends correct request body with filter and sorts", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    const filter = { property: "Status", select: { equals: "Done" } };
    const sorts = [{ property: "Date", direction: "descending" }];

    const result = await fetchNotionDatabaseItems("db-1", {
      filter,
      sorts,
      limit: 3,
    });
    expect(result).toEqual([]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.notion.com/v1/databases/db-1/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          page_size: 3,
          filter,
          sorts,
        }),
      })
    );
  });

  it("uses page url as fallback when URL prop missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: "page-3",
              url: "https://notion.so/page-3",
              created_time: "2024-01-01T00:00:00Z",
              cover: null,
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: "No URL" }],
                },
              },
            },
          ],
        }),
    });

    const result = await fetchNotionDatabaseItems("db-1");
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://notion.so/page-3");
  });

  it("uses cover image when Image prop is missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: "page-4",
              url: "https://notion.so/page-4",
              created_time: "2024-01-01T00:00:00Z",
              cover: {
                type: "external",
                external: { url: "https://cover.example.com/img.jpg" },
              },
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: "Cover Page" }],
                },
              },
            },
          ],
        }),
    });

    const result = await fetchNotionDatabaseItems("db-1");
    expect(result).toHaveLength(1);
    const meta = result[0].metadata as Record<string, unknown>;
    expect(meta.imageUrl).toBe("https://cover.example.com/img.jpg");
  });
});

// ─────────────────────────────────────────────────────────────
// fetchNotionBookmarkBlocks
// ─────────────────────────────────────────────────────────────
describe("fetchNotionBookmarkBlocks", () => {
  it("returns [] when API responds with non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
    });

    const result = await fetchNotionBookmarkBlocks("block-1");
    expect(result).toEqual([]);
  });

  it("filters and maps bookmark blocks to EntityInput", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: "bm-1",
              type: "bookmark",
              created_time: "2024-02-01T12:00:00Z",
              bookmark: { url: "https://example.com/article" },
            },
            {
              id: "bm-2",
              type: "bookmark",
              created_time: "2024-02-02T12:00:00Z",
              bookmark: { url: "https://example.com/docs" },
            },
          ],
        }),
    });

    const result = await fetchNotionBookmarkBlocks("block-1", {
      connectionId: "conn-1",
      resourceId: "res-1",
    });
    expect(result).toHaveLength(2);

    expect(result[0].kind).toBe("notion_bookmark");
    expect(result[0].title).toBe("https://example.com/article");
    expect(result[0].url).toBe("https://example.com/article");
    expect(result[0].body).toBeNull();
    expect(result[0].summary).toBeNull();
    expect(result[0].externalId).toBe("bm-1");
    expect(result[0].connectionId).toBe("conn-1");
    expect(result[0].resourceId).toBe("res-1");

    const meta = result[0].metadata as Record<string, unknown>;
    const notion = meta.notion as Record<string, unknown>;
    expect(notion.block_id).toBe("bm-1");
    expect(notion.parent_id).toBe("block-1");

    expect(result[1].title).toBe("https://example.com/docs");
  });

  it("skips non-bookmark blocks", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: "p-1",
              type: "paragraph",
              created_time: "2024-02-01T12:00:00Z",
              paragraph: { rich_text: [{ plain_text: "Hello" }] },
            },
            {
              id: "h-1",
              type: "heading_1",
              created_time: "2024-02-01T12:00:00Z",
              heading_1: { rich_text: [{ plain_text: "Title" }] },
            },
            {
              id: "bm-1",
              type: "bookmark",
              created_time: "2024-02-01T12:00:00Z",
              bookmark: { url: "https://example.com" },
            },
          ],
        }),
    });

    const result = await fetchNotionBookmarkBlocks("block-1");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("notion_bookmark");
    expect(result[0].externalId).toBe("bm-1");
  });

  it("respects limit option", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: "bm-1",
              type: "bookmark",
              created_time: "2024-02-01T12:00:00Z",
              bookmark: { url: "https://example.com/1" },
            },
            {
              id: "bm-2",
              type: "bookmark",
              created_time: "2024-02-02T12:00:00Z",
              bookmark: { url: "https://example.com/2" },
            },
            {
              id: "bm-3",
              type: "bookmark",
              created_time: "2024-02-03T12:00:00Z",
              bookmark: { url: "https://example.com/3" },
            },
          ],
        }),
    });

    const result = await fetchNotionBookmarkBlocks("block-1", { limit: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://example.com/1");
    expect(result[1].url).toBe("https://example.com/2");
  });

  it("returns [] when API throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const result = await fetchNotionBookmarkBlocks("block-1");
    expect(result).toEqual([]);
  });

  it("returns [] when no bookmark blocks exist", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: "p-1",
              type: "paragraph",
              created_time: "2024-02-01T12:00:00Z",
              paragraph: { rich_text: [] },
            },
          ],
        }),
    });

    const result = await fetchNotionBookmarkBlocks("block-1");
    expect(result).toEqual([]);
  });
});
