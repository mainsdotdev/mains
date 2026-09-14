import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { trelloCardsFetcher } from "./trello";
import type { SelectedResource } from "../sync.dto";

beforeEach(() => {
  vi.clearAllMocks();
});

const validResource: SelectedResource = {
  id: "res-1",
  connectionId: "conn-1",
  externalId: "board-1",
  name: "My Board",
  kind: "trello_board",
  metadata: {},
};

const baseArgs = {
  secrets: { token: "trello_token", apiKey: "trello_key" },
  metadata: {},
  limit: 10,
  connectionId: "conn-1",
};

function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("trelloCardsFetcher.fetchForResource", () => {
  it("returns [] when token or apiKey missing", async () => {
    const r1 = await trelloCardsFetcher.fetchForResource({
      ...baseArgs,
      secrets: { apiKey: "key" },
      resource: validResource,
    });
    const r2 = await trelloCardsFetcher.fetchForResource({
      ...baseArgs,
      secrets: { token: "tok" },
      resource: validResource,
    });
    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] when cards endpoint responds non-ok", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse([])) // lists endpoint
      .mockResolvedValueOnce(mockResponse({}, false, 500)); // cards endpoint

    const result = await trelloCardsFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });
    expect(result).toEqual([]);
  });

  it("normalizes cards with list names", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockResponse([
          { id: "list-1", name: "Doing", closed: false },
          { id: "list-2", name: "Done", closed: false },
        ]),
      )
      .mockResolvedValueOnce(
        mockResponse([
          {
            id: "card-1",
            name: "Fix login",
            desc: "User can't log in",
            shortUrl: "https://trello.com/c/abc",
            idShort: 5,
            shortLink: "abc",
            dateLastActivity: "2025-01-01T00:00:00Z",
            closed: false,
            due: null,
            dueComplete: false,
            labels: [{ id: "l1", name: "bug", color: "red" }],
            idMembers: ["u1"],
            idList: "list-1",
          },
        ]),
      );

    const result = await trelloCardsFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "issue",
      externalId: "board-1#5",
      title: "Fix login",
      metadata: {
        provider: "trello",
        cardId: "card-1",
        boardId: "board-1",
        idShort: 5,
        listName: "Doing",
        labels: ["bug"],
        memberCount: 1,
        state: "open",
      },
    });
  });

  it("passes apiKey and token as query params", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse([]))
      .mockResolvedValueOnce(mockResponse([]));

    await trelloCardsFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    const cardsCall = mockFetch.mock.calls[1][0] as string;
    expect(cardsCall).toContain("key=trello_key");
    expect(cardsCall).toContain("token=trello_token");
  });
});

describe("fetcher metadata", () => {
  it("uses trello_board kind", () => {
    expect(trelloCardsFetcher.provider).toBe("trello");
    expect(trelloCardsFetcher.resourceKind).toBe("trello_board");
  });
});
