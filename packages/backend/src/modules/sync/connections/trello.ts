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
import { normalizeLimit, normalizeDateToIso } from "../sync.connection-utils";

const TRELLO_BASE_URL = "https://api.trello.com/1";
const MAX_ITEMS_PER_PAGE = 100;
const DEFAULT_LIMIT = 50;

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
  try {
    const authParams = buildAuthParams(apiKey, token);
    const response = await fetch(
      `${TRELLO_BASE_URL}/boards/${boardId}/lists?${authParams}&fields=id,name,closed&filter=open`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) return new Map();
    const lists = (await response.json()) as TrelloList[];
    const m = new Map<string, string>();
    for (const list of lists) m.set(list.id, list.name);
    return m;
  } catch {
    return new Map();
  }
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
  defaultLimit: DEFAULT_LIMIT,

  async fetchForResource({
    resource,
    secrets,
    limit,
    connectionId,
  }: ResourceFetcherArgs): Promise<EntityInput[]> {
    const token = secrets.token;
    const apiKey = secrets.apiKey;
    if (!token || !apiKey) return [];

    const boardId = resource.externalId;
    const normalizedLimit = normalizeLimit(limit, 1, MAX_ITEMS_PER_PAGE);
    const authParams = buildAuthParams(apiKey, token);

    const listMap = await fetchBoardLists(boardId, apiKey, token);

    const fields =
      "id,name,desc,shortUrl,idShort,shortLink,dateLastActivity,closed,due,dueComplete,labels,idMembers,idList";
    const response = await fetch(
      `${TRELLO_BASE_URL}/boards/${boardId}/cards?${authParams}&fields=${fields}&filter=open&limit=${normalizedLimit}`,
      { headers: { Accept: "application/json" } },
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`Trello API error (${response.status}):`, error);
      return [];
    }

    const cards = (await response.json()) as TrelloCard[];

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
          repo: boardId,
          number: card.idShort,
          state: card.closed ? "closed" : "open",
        },
      };
    });
  },
};
