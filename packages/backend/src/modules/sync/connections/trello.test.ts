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
  it("is incremental", () => {
    expect(trelloCardsFetcher.incremental).toBe(true);
  });

  it("throws when token or apiKey is missing, so the runner keeps its cursor", async () => {
    await expect(
      trelloCardsFetcher.fetchForResource({ ...baseArgs, secrets: { apiKey: "key" }, resource: validResource }),
    ).rejects.toThrow();
    await expect(
      trelloCardsFetcher.fetchForResource({ ...baseArgs, secrets: { token: "tok" }, resource: validResource }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when the cards endpoint responds non-ok", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse([])) // lists endpoint
      .mockResolvedValueOnce(mockResponse({}, false, 500)); // cards endpoint

    await expect(
      trelloCardsFetcher.fetchForResource({ ...baseArgs, resource: validResource }),
    ).rejects.toThrow(/500/);
  });

  it("throws when the lists endpoint fails, rather than sync every card as todo", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, false, 500));
    await expect(
      trelloCardsFetcher.fetchForResource({ ...baseArgs, resource: validResource }),
    ).rejects.toThrow(/500/);
  });

  it("adds cards archived since the cursor, closed and without a list state", async () => {
    const card = (id: string, idShort: number, closed: boolean, dateLastActivity: string) => ({
      id,
      name: id,
      desc: "",
      shortUrl: `https://trello.com/c/${id}`,
      idShort,
      shortLink: id,
      dateLastActivity,
      closed,
      due: null,
      dueComplete: false,
      labels: [],
      idMembers: [],
      idList: "list-1",
    });
    mockFetch
      .mockResolvedValueOnce(mockResponse([{ id: "list-1", name: "Doing", closed: false }]))
      .mockResolvedValueOnce(mockResponse([card("open-1", 1, false, "2025-03-02T00:00:00Z")]))
      .mockResolvedValueOnce(
        mockResponse([
          card("archived-new", 2, true, "2025-03-02T00:00:00Z"),
          card("archived-old", 3, true, "2025-01-01T00:00:00Z"),
        ]),
      );

    const result = await trelloCardsFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
      since: new Date("2025-03-01T00:00:00Z"),
    });

    expect(mockFetch.mock.calls[2][0]).toContain("filter=closed");
    expect(result.map((r) => r.metadata)).toEqual([
      expect.objectContaining({ cardId: "open-1", state: "Doing", statusId: "in_progress" }),
      expect.objectContaining({ cardId: "archived-new", state: "Archived", stateId: null, statusId: "done" }),
    ]);
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
            members: [{ fullName: "Alice Doe", avatarUrl: "https://trello-members.s3/abc" }],
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
        // The list is the card's workflow state.
        state: "Doing",
        stateId: "list-1",
        statusId: "in_progress",
        identifier: "#5",
        labelColors: { bug: "#f87168" },
        assignee: "Alice Doe",
        assigneeAvatarUrl: "https://trello-members.s3/abc/50.png",
      },
    });
    expect(mockFetch.mock.calls[1][0]).toContain("members=true");
  });

  it("closes a card that sits in a Done list", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse([{ id: "list-2", name: "Done", closed: false }]))
      .mockResolvedValueOnce(
        mockResponse([
          {
            id: "card-2",
            name: "Ship it",
            desc: "",
            shortUrl: "https://trello.com/c/def",
            idShort: 6,
            shortLink: "def",
            dateLastActivity: "2025-01-01T00:00:00Z",
            closed: false,
            due: null,
            dueComplete: false,
            labels: [],
            idMembers: [],
            idList: "list-2",
          },
        ]),
      );

    const [card] = await trelloCardsFetcher.fetchForResource({
      ...baseArgs,
      resource: validResource,
    });

    expect(card.metadata).toMatchObject({ state: "Done", stateId: "list-2", statusId: "done" });
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

describe("trelloCardsFetcher.listStates", () => {
  it("lists the board's open lists, guessing a status from each name", async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        { id: "l1", name: "Backlog", closed: false },
        { id: "l2", name: "Doing", closed: false },
        { id: "l3", name: "Done", closed: false },
      ]),
    );

    const states = await trelloCardsFetcher.listStates!({
      resource: validResource,
      secrets: baseArgs.secrets,
      metadata: {},
    });

    expect(states).toEqual([
      { id: "l1", name: "Backlog", color: null, defaultStatusId: "backlog" },
      { id: "l2", name: "Doing", color: null, defaultStatusId: "in_progress" },
      { id: "l3", name: "Done", color: null, defaultStatusId: "done" },
    ]);
  });
});

describe("fetcher metadata", () => {
  it("uses trello_board kind", () => {
    expect(trelloCardsFetcher.provider).toBe("trello");
    expect(trelloCardsFetcher.resourceKind).toBe("trello_board");
  });
});
