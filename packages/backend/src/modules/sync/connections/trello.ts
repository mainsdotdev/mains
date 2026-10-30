/**
 * Trello Connection Fetcher
 *
 * Fetches cards from Trello using REST API v1.
 * Authentication uses an apiKey + token pair passed as query parameters.
 *
 * Trello-specific assumptions:
 * - secrets.token + secrets.apiKey
 * - Boards are stored as connectionResources with kind = "trello_board"
 * - Cards are normalized to EntityInput with provider = "trello" and kind = "issue"
 */

import type {
  EntityInput,
  ResourceFetcher,
  ResourceFetcherArgs,
} from "../sync.dto";
import { normalizeDateToIso } from "../sync.connection-utils";
import { statusFromName } from "../sync.issue-status";
import { labelColorMap } from "../sync.issue-display";

const TRELLO_BASE_URL = "https://api.trello.com/1";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface TrelloLabel {
  id: string;
  name: string;
  color: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  shortUrl: string;
  idShort: number;
  shortLink: string;
  dateLastActivity: string;
  closed: boolean;
  due: string | null;
  dueComplete: boolean;
  labels: TrelloLabel[];
  idMembers: string[];
  idList: string;
  /** With `members=true`: the card's members, first one shown as its assignee. */
  members?: Array<{ fullName?: string; avatarUrl?: string | null }>;
}

/** Trello hands out an avatar base URL; the size is a path suffix. */
function avatarOf(member: { avatarUrl?: string | null } | undefined): string | null {
  return member?.avatarUrl ? `${member.avatarUrl}/50.png` : null;
}

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

export interface TrelloBoardInfo {
  id: string;
  name: string;
  shortLink: string;
  shortUrl: string;
  closed: boolean;
  desc: string;
  prefs: { background: string; backgroundColor: string | null };
  organization?: { displayName: string } | null;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function buildAuthParams(apiKey: string, token: string): string {
  return `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;
}

async function fetchBoardLists(
  boardId: string,
  apiKey: string,
  token: string,
): Promise<Map<string, string>> {
  // A card's list is its state, so a failed lookup must fail the fetch —
  // otherwise every card would sync as "todo".
  const authParams = buildAuthParams(apiKey, token);
  const lists = await getJson<TrelloList[]>(
    `${TRELLO_BASE_URL}/boards/${boardId}/lists?${authParams}&fields=id,name,closed&filter=open`,
  );
  return new Map(lists.map((list) => [list.id, list.name]));
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const error = await response.text();
    console.error(`Trello API error (${response.status}):`, error);
    throw new Error(`Trello API error: ${response.status}`);
  }
  return (await response.json()) as T;
}

// ─────────────────────────────────────────────────────────────
// Public list-boards helper (used by the connections module)
// ─────────────────────────────────────────────────────────────

export async function fetchTrelloBoards(
  apiKey: string,
  token: string,
): Promise<TrelloBoardInfo[]> {
  const authParams = buildAuthParams(apiKey, token);
  const response = await fetch(
    `${TRELLO_BASE_URL}/members/me/boards?${authParams}&fields=id,name,shortLink,shortUrl,closed,desc,prefs,organization&filter=open`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    const error = await response.text();
    console.error(`Trello API error (${response.status}):`, error);
    throw new Error(`Trello API error: ${response.status}`);
  }
  const boards = (await response.json()) as TrelloBoardInfo[];
  return boards.filter((b) => !b.closed);
}

// ─────────────────────────────────────────────────────────────
// Fetcher
// ─────────────────────────────────────────────────────────────

export const trelloCardsFetcher: ResourceFetcher = {
  id: "trello:cards",
  provider: "trello",
  resourceKind: "trello_board",
  defaultLimit: 1000,
  incremental: true,

  async fetchForResource({
    resource,
    secrets,
    limit,
    connectionId,
    since,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = secrets.token;
    const apiKey = secrets.apiKey;
    if (!token || !apiKey) throw new Error("Trello connection is missing its token or API key");

    const boardId = resource.externalId;
    const authParams = buildAuthParams(apiKey, token);

    const listMap = await fetchBoardLists(boardId, apiKey, token);

    // Members ride along on the card request instead of a lookup per board.
    const fields =
      "id,name,desc,shortUrl,idShort,shortLink,dateLastActivity,closed,due,dueComplete,labels,idMembers,idList&members=true&member_fields=fullName,avatarUrl";
    // Trello returns a board's cards in one response. A card moved between
    // lists is still open, so the open set is fetched every time; archiving
    // takes a card out of it, so changes add the cards archived since.
    const open = await getJson<TrelloCard[]>(
      `${TRELLO_BASE_URL}/boards/${boardId}/cards?${authParams}&fields=${fields}&filter=open`,
    );
    const archived = since
      ? (
          await getJson<TrelloCard[]>(
            `${TRELLO_BASE_URL}/boards/${boardId}/cards?${authParams}&fields=${fields}&filter=closed`,
          )
        ).filter((card) => new Date(card.dateLastActivity) >= since)
      : [];
    const cards = [...open, ...archived].slice(0, limit);

    return cards.map((card): EntityInput => {
      const labelNames = (card.labels || [])
        .map((l) => l.name)
        .filter(Boolean);
      const listName = listMap.get(card.idList) || null;

      return {
        kind: "issue",
        title: card.name,
        url: card.shortUrl,
        body: card.desc || null,
        summary: card.desc?.substring(0, 500) || null,
        occurredAt: normalizeDateToIso(card.dateLastActivity),
        externalId: `${boardId}#${card.idShort}`,
        connectionId,
        resourceId: resource.id,
        metadata: {
          provider: "trello",
          cardId: card.id,
          boardId,
          idShort: card.idShort,
          shortLink: card.shortLink,
          closed: card.closed,
          due: card.due,
          dueComplete: card.dueComplete,
          listName,
          labels: labelNames,
          memberCount: card.idMembers?.length || 0,
          identifier: `#${card.idShort}`,
          labelColors: labelColorMap(card.labels || []),
          assignee: card.members?.[0]?.fullName || null,
          assigneeAvatarUrl: avatarOf(card.members?.[0]),
          dueAt: card.due,
          repo: boardId,
          number: card.idShort,
          // A card's list is its workflow state — a column the user named.
          // Archiving isn't a list, so an archived card has no state id for
          // a list mapping to reopen it by.
          state: card.closed ? "Archived" : (listName ?? "open"),
          stateId: card.closed ? null : card.idList,
          statusId: card.closed ? "done" : statusFromName(listName),
        },
      };
    });
  },

  async listStates({ resource, secrets }) {
    const token = secrets.token;
    const apiKey = secrets.apiKey;
    if (!token || !apiKey) throw new Error("Trello connection is missing its token or API key");

    const lists = await fetchBoardLists(resource.externalId, apiKey, token);
    return [...lists].map(([id, name]) => ({
      id,
      name,
      color: null,
      defaultStatusId: statusFromName(name),
    }));
  },
};
