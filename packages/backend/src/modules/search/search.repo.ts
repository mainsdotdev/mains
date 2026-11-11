import { getSqlite } from "../../db/client";
import type { ConversationSearchCursor } from "@mains/contracts/search";

export interface ConversationMatchRow {
  id: string; title: string | null; goal: string | null; providerId: string; mode: string;
  context: string | null; updatedAt: number; createdAt: number; rank: number;
  artifactId: number | null; messageTime: number | null; matchSnippet: string | null;
}

interface SearchRepoOptions {
  accountId: string;
  query: string;
  limit: number;
}

interface WorkspaceSearchRow {
  id: string;
  name: string;
  rootPath: string;
  updatedAt: number;
}

interface RunSearchRow {
  id: string;
  title: string | null;
  goal: string | null;
  workspaceId: string | null;
  collectionId: string | null;
  spaceId: string | null;
  providerId: string;
  mode: string;
  workspaceName: string | null;
  collectionName: string | null;
  updatedAt: number;
}

interface DocumentSearchRow extends RunSearchRow {
  artifactId: number;
  path: string | null;
  content: string | null;
  createdAt: number;
}

interface MessageSearchRow extends RunSearchRow {
  artifactId: number;
  matchSnippet: string;
  speaker: "You" | "Agent";
  messageCreatedAt: number;
  relevance: number;
}

const MAX_FTS_TERMS = 12;
const MAX_FTS_TERM_LENGTH = 64;

/**
 * Turn arbitrary command-menu input into a literal, prefix-enabled FTS5 query.
 * Keeping operators out of user input both avoids syntax errors and makes
 * punctuation-heavy prompts (quotes, paths, C++, etc.) safe to search.
 */
export function buildFtsQuery(value: string): string | null {
  const terms = value
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, MAX_FTS_TERMS)
    .map((term) => term.slice(0, MAX_FTS_TERM_LENGTH))
    .filter(Boolean);
  if (!terms?.length) return null;
  return terms.map((term) => `"${term}"*`).join(" AND ");
}

function escapeLike(value: string): string {
  return value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
}

function bindings({ accountId, query, limit }: SearchRepoOptions) {
  const escaped = escapeLike(query);
  return {
    accountId,
    exact: query,
    prefix: `${escaped}%`,
    contains: `%${escaped}%`,
    limit,
  };
}

/**
 * Read-only global search projection. Queries stay intentionally bounded and
 * return only the fields the command menu needs to rank and navigate.
 */
export const searchRepo = {
  findConversations(options: SearchRepoOptions & { cursor?: ConversationSearchCursor }): ConversationMatchRow[] {
    const cursor = options.cursor;
    const ftsQuery = buildFtsQuery(options.query);
    const metadata = "CASE WHEN json_valid(a.metadata) THEN a.metadata ELSE '{}' END";
    return getSqlite().prepare(`
      WITH raw_matches AS MATERIALIZED (
        SELECT a.run_id AS runId, a.id AS artifactId,
          a.created_at * 1000 AS messageTime,
          substr(snippet(run_artifacts_fts, 0, '', '', '…', 28), 1, 400) AS matchSnippet,
          bm25(run_artifacts_fts) AS relevance
        FROM run_artifacts_fts JOIN run_artifacts a ON a.id = run_artifacts_fts.rowid
        JOIN runs r ON r.id = a.run_id
        WHERE run_artifacts_fts MATCH @ftsQuery AND @hasFts = 1 AND r.account_id = @accountId AND r.is_archived = 0
          AND a.kind IN ('user-prompt', 'report', 'result')
          AND coalesce(json_extract(${metadata}, '$.kind'), '') <> 'thinking'
          AND coalesce(json_extract(${metadata}, '$.source'), '') NOT IN ('agent_thinking_streaming', 'assistant.reasoning_delta')
          AND coalesce(json_extract(${metadata}, '$.voice'), 0) <> 1
          AND coalesce(json_extract(${metadata}, '$.isFromSubagent'), 0) <> 1
          AND json_extract(${metadata}, '$.agentId') IS NULL
          AND json_extract(${metadata}, '$.parentToolCallId') IS NULL
          AND json_extract(${metadata}, '$.parentToolUseId') IS NULL
      ), ranked_messages AS (
        SELECT *, row_number() OVER (PARTITION BY runId ORDER BY relevance, artifactId DESC) AS messageRank FROM raw_matches
      ), candidates AS (
        SELECT r.id, substr(r.title, 1, 160) AS title, substr(r.goal, 1, 200) AS goal,
          r.provider_id AS providerId, r.mode, substr(coalesce(w.name, c.name), 1, 160) AS context,
          r.updated_at * 1000 AS updatedAt, r.created_at * 1000 AS createdAt,
          m.artifactId, m.messageTime, m.matchSnippet,
          CASE WHEN lower(coalesce(r.title, '')) = lower(@exact) THEN 0
            WHEN r.title LIKE @prefix ESCAPE '!' THEN 1
            WHEN r.title LIKE @contains ESCAPE '!' THEN 2
            WHEN r.goal LIKE @contains ESCAPE '!' THEN 3 ELSE 4 END AS rank
        FROM runs r LEFT JOIN ranked_messages m ON m.runId = r.id AND m.messageRank = 1
        LEFT JOIN workspaces w ON w.id = r.workspace_id LEFT JOIN collections c ON c.id = r.collection_id
        WHERE r.account_id = @accountId AND r.is_archived = 0
          AND (r.title LIKE @contains ESCAPE '!' OR r.goal LIKE @contains ESCAPE '!' OR m.artifactId IS NOT NULL)
      ) SELECT * FROM candidates
      WHERE @hasCursor = 0 OR rank > @rank
        OR (rank = @rank AND (createdAt < @createdAt OR (createdAt = @createdAt AND id > @runId)))
      ORDER BY rank, createdAt DESC, id LIMIT @limit
    `).all({ ...bindings(options), ftsQuery: ftsQuery ?? '"__mains_empty_query__"', hasFts: Number(!!ftsQuery),
      hasCursor: Number(!!cursor), rank: cursor?.rank ?? 0, createdAt: cursor?.createdAt ?? 0, runId: cursor?.runId ?? "" }) as ConversationMatchRow[];
  },
  findWorkspaces(options: SearchRepoOptions): WorkspaceSearchRow[] {
    return getSqlite()
      .prepare(
        `SELECT
           w.id,
           w.name,
           w.root_path AS rootPath,
           w.updated_at AS updatedAt
         FROM workspaces w
         WHERE w.account_id = @accountId
           AND w.is_archived = 0
           AND (
             w.name LIKE @contains ESCAPE '!'
             OR w.root_path LIKE @contains ESCAPE '!'
           )
         ORDER BY
           CASE
             WHEN lower(w.name) = lower(@exact) THEN 0
             WHEN w.name LIKE @prefix ESCAPE '!' THEN 1
             WHEN w.name LIKE @contains ESCAPE '!' THEN 2
             ELSE 3
           END,
           w.updated_at DESC
         LIMIT @limit`,
      )
      .all(bindings(options)) as WorkspaceSearchRow[];
  },

  findRuns(options: SearchRepoOptions): RunSearchRow[] {
    return getSqlite()
      .prepare(
        `SELECT
           r.id,
           r.title,
           r.goal,
           r.workspace_id AS workspaceId,
           r.collection_id AS collectionId,
           r.space_id AS spaceId,
           r.provider_id AS providerId,
           r.mode,
           w.name AS workspaceName,
           c.name AS collectionName,
           r.updated_at AS updatedAt
         FROM runs r
         LEFT JOIN workspaces w ON w.id = r.workspace_id
         LEFT JOIN collections c ON c.id = r.collection_id
         WHERE r.account_id = @accountId
           AND r.is_archived = 0
           AND (
             r.title LIKE @contains ESCAPE '!'
             OR r.goal LIKE @contains ESCAPE '!'
           )
         ORDER BY
           CASE
             WHEN lower(coalesce(r.title, '')) = lower(@exact) THEN 0
             WHEN r.title LIKE @prefix ESCAPE '!' THEN 1
             WHEN r.title LIKE @contains ESCAPE '!' THEN 2
             ELSE 3
           END,
           r.updated_at DESC
         LIMIT @limit`,
      )
      .all(bindings(options)) as RunSearchRow[];
  },

  findMessages(options: SearchRepoOptions): MessageSearchRow[] {
    const ftsQuery = buildFtsQuery(options.query);
    if (!ftsQuery) return [];

    return getSqlite()
      .prepare(
        `WITH raw_matches AS MATERIALIZED (
           SELECT
             a.id AS artifactId,
             a.run_id AS id,
             snippet(run_artifacts_fts, 0, '', '', '…', 28) AS matchSnippet,
             CASE
               WHEN a.kind = 'user-prompt'
                 OR json_extract(a.metadata, '$.kind') = 'user-prompt'
               THEN 'You'
               ELSE 'Agent'
             END AS speaker,
             a.created_at AS messageCreatedAt,
             bm25(run_artifacts_fts) AS relevance,
             r.title,
             r.goal,
             r.workspace_id AS workspaceId,
             r.collection_id AS collectionId,
             r.space_id AS spaceId,
             r.provider_id AS providerId,
             r.mode,
             w.name AS workspaceName,
             c.name AS collectionName,
             r.updated_at AS updatedAt
           FROM run_artifacts_fts
           INNER JOIN run_artifacts a ON a.id = run_artifacts_fts.rowid
           INNER JOIN runs r ON r.id = a.run_id
           LEFT JOIN workspaces w ON w.id = r.workspace_id
           LEFT JOIN collections c ON c.id = r.collection_id
           WHERE run_artifacts_fts MATCH @ftsQuery
             AND r.account_id = @accountId
             AND r.is_archived = 0
         ),
         ranked_matches AS (
           SELECT
             raw_matches.*,
             row_number() OVER (
               PARTITION BY id
               ORDER BY relevance, artifactId DESC
             ) AS matchRank
           FROM raw_matches
         )
         SELECT
           artifactId,
           id,
           matchSnippet,
           speaker,
           messageCreatedAt,
           relevance,
           title,
           goal,
           workspaceId,
           collectionId,
           spaceId,
           providerId,
           mode,
           workspaceName,
           collectionName,
           updatedAt
         FROM ranked_matches
         WHERE matchRank = 1
         ORDER BY relevance, updatedAt DESC
         LIMIT @limit`,
      )
      .all({
        accountId: options.accountId,
        ftsQuery,
        limit: options.limit,
      }) as MessageSearchRow[];
  },

  findDocuments(options: SearchRepoOptions): DocumentSearchRow[] {
    return getSqlite()
      .prepare(
        `SELECT
           a.id AS artifactId,
           a.run_id AS id,
           a.path,
           a.content,
           a.created_at AS createdAt,
           r.title,
           r.goal,
           r.workspace_id AS workspaceId,
           r.collection_id AS collectionId,
           r.space_id AS spaceId,
           r.provider_id AS providerId,
           r.mode,
           w.name AS workspaceName,
           c.name AS collectionName,
           r.updated_at AS updatedAt
         FROM run_artifacts a
         INNER JOIN runs r ON r.id = a.run_id
         LEFT JOIN workspaces w ON w.id = r.workspace_id
         LEFT JOIN collections c ON c.id = r.collection_id
         WHERE r.account_id = @accountId
           AND r.is_archived = 0
           AND a.kind = 'document'
           AND (
             a.path LIKE @contains ESCAPE '!'
             OR a.content LIKE @contains ESCAPE '!'
           )
         ORDER BY
           CASE
             WHEN lower(coalesce(a.path, '')) = lower(@exact) THEN 0
             WHEN a.path LIKE @prefix ESCAPE '!' THEN 1
             WHEN a.path LIKE @contains ESCAPE '!' THEN 2
             ELSE 3
           END,
           a.created_at DESC
         LIMIT @limit`,
      )
      .all(bindings(options)) as DocumentSearchRow[];
  },
};

export type {
  DocumentSearchRow,
  MessageSearchRow,
  RunSearchRow,
  WorkspaceSearchRow,
};
