import path from "node:path";
import type {
  GlobalSearchQuery,
  GlobalSearchResult,
  ConversationSearchQuery,
  ConversationSearchPage,
} from "@mains/contracts/search";
import { isModeId } from "@mains/contracts/modes";
import { isProviderId } from "@mains/contracts/provider-ids";
import {
  searchRepo,
  type DocumentSearchRow,
  type MessageSearchRow,
  type RunSearchRow,
} from "./search.repo";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_QUERY_LENGTH = 200;

function epochMilliseconds(value: number): number {
  // SQLite timestamp columns are stored as epoch seconds. Be tolerant of a
  // future millisecond value so the wire shape never flips units.
  return value < 10_000_000_000 ? value * 1000 : value;
}

function firstMeaningfulLine(value: string | null, fallback: string): string {
  const line = value?.split("\n").find((part) => part.trim())?.trim();
  return line || fallback;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function searchSnippet(content: string | null, query: string): string | null {
  if (!content) return null;
  const normalized = compact(content);
  if (!normalized) return null;
  const matchAt = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, matchAt < 0 ? 0 : matchAt - 64);
  const end = Math.min(normalized.length, start + 170);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${
    end < normalized.length ? "…" : ""
  }`;
}

function runContext(row: RunSearchRow): string | null {
  return row.workspaceName ?? row.collectionName ?? null;
}

function runNavigation(row: RunSearchRow) {
  return {
    workspaceId: row.workspaceId,
    runId: row.id,
    collectionId: row.collectionId,
    spaceId: row.spaceId,
    providerId: isProviderId(row.providerId) ? row.providerId : null,
    mode: isModeId(row.mode) ? row.mode : null,
  };
}

function messageSnippet(row: MessageSearchRow): string {
  return `${row.speaker}: ${compact(row.matchSnippet)}`;
}

function mapRun(
  row: RunSearchRow,
  query: string,
  messageMatch?: MessageSearchRow,
): GlobalSearchResult {
  const title = row.title?.trim() || firstMeaningfulLine(row.goal, "Untitled chat");
  return {
    id: row.id,
    kind: "run",
    title,
    subtitle: runContext(row),
    snippet: messageMatch
      ? messageSnippet(messageMatch)
      : row.title?.trim()
        ? searchSnippet(row.goal, query)
        : null,
    updatedAt: epochMilliseconds(row.updatedAt),
    ...runNavigation(row),
    path: null,
  };
}

function mergeRunResults(
  runRows: RunSearchRow[],
  messageRows: MessageSearchRow[],
  query: string,
  limit: number,
): GlobalSearchResult[] {
  const messagesByRun = new Map(messageRows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const results: GlobalSearchResult[] = [];

  for (const row of runRows) {
    seen.add(row.id);
    results.push(mapRun(row, query, messagesByRun.get(row.id)));
  }
  for (const row of messageRows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    results.push(mapRun(row, query, row));
  }
  return results.slice(0, limit);
}

function mapDocument(
  row: DocumentSearchRow,
  query: string,
): GlobalSearchResult {
  const documentTitle = row.path
    ? path.basename(row.path)
    : `Document from ${row.title?.trim() || "untitled chat"}`;
  return {
    id: `document:${row.artifactId}`,
    kind: "document",
    title: documentTitle,
    subtitle: runContext(row) ?? row.title?.trim() ?? null,
    snippet: searchSnippet(row.content, query),
    updatedAt: epochMilliseconds(row.createdAt),
    ...runNavigation(row),
    path: row.path,
  };
}

export const searchService = {
  async conversations(input: ConversationSearchQuery): Promise<ConversationSearchPage> {
    if (!input || typeof input.query !== "string" || typeof input.accountId !== "string" || !input.accountId.trim() || input.accountId.length > 200) throw new Error("Choose an account and search query");
    const query = input.query.trim().normalize("NFKC").slice(0, MAX_QUERY_LENGTH);
    if (!query) return { items: [], nextCursor: null };
    const cursor = input.cursor;
    if (cursor && (!Number.isSafeInteger(cursor.rank) || cursor.rank < 0 || cursor.rank > 4 ||
      !Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0 || typeof cursor.runId !== "string" || !cursor.runId || cursor.runId.length > 200)) throw new Error("Invalid search cursor");
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(input.limit) ? Math.floor(input.limit!) : MAX_LIMIT));
    const rows = searchRepo.findConversations({ accountId: input.accountId.trim(), query, cursor, limit: limit + 1 });
    const page = rows.slice(0, limit), last = page.at(-1);
    return {
      items: page.map(row => ({ runId: row.id, title: row.title?.trim() || firstMeaningfulLine(row.goal, "Untitled chat"),
        providerId: row.providerId, mode: row.mode, context: row.context, updatedAt: row.updatedAt,
        snippet: row.matchSnippet ? compact(row.matchSnippet) : searchSnippet(row.goal, query),
        messageCursor: row.artifactId != null && row.messageTime != null ? { timestamp: row.messageTime, source: "artifact" as const, id: row.artifactId } : null })),
      nextCursor: rows.length > limit && last ? { rank: last.rank, createdAt: last.createdAt, runId: last.id } : null,
    };
  },
  async query(input: GlobalSearchQuery): Promise<GlobalSearchResult[]> {
    const query = input.query.trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) return [];

    const accountId = input.accountId?.trim() || "default";
    const requestedLimit = Number.isFinite(input.limitPerKind)
      ? Math.floor(input.limitPerKind as number)
      : DEFAULT_LIMIT;
    const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit));
    const options = { accountId, query, limit };

    const [workspaceRows, runRows, messageRows, documentRows] = await Promise.all([
      Promise.resolve(searchRepo.findWorkspaces(options)),
      Promise.resolve(searchRepo.findRuns(options)),
      Promise.resolve(searchRepo.findMessages(options)),
      Promise.resolve(searchRepo.findDocuments(options)),
    ]);

    return [
      ...workspaceRows.map<GlobalSearchResult>((row) => ({
        id: row.id,
        kind: "workspace",
        title: row.name,
        subtitle: row.rootPath,
        snippet: null,
        updatedAt: epochMilliseconds(row.updatedAt),
        workspaceId: row.id,
        runId: null,
        collectionId: null,
        spaceId: null,
        providerId: null,
        mode: "developer",
        path: row.rootPath,
      })),
      ...mergeRunResults(runRows, messageRows, query, limit),
      ...documentRows.map((row) => mapDocument(row, query)),
    ];
  },
};
