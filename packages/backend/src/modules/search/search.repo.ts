import { getSqlite } from "../../db/client";

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
