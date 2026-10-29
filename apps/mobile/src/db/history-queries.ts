import { and, desc, eq, getTableColumns, sql, type SQLWrapper } from "drizzle-orm";

import type { Db } from "./client";
import { runArtifacts, runTurns, toolCalls } from "./schema";

const deferredJson = (column: SQLWrapper) => sql<string | null>`CASE WHEN length(${column}) > 16384
  THEN json_object('type', 'mains/deferred-tool-output', 'chars', length(${column}), 'preview', substr(${column}, 1, 2000))
  ELSE ${column} END`;

/** Old caches can contain full outputs. Bound them in SQLite before the first render. */
export function cachedHistoryQueries(db: Db, backendId: string, runId: string) {
  const metadata = sql<string | null>`CASE WHEN length(${runArtifacts.metadataJson}) <= 16384 THEN ${runArtifacts.metadataJson} ELSE NULL END`;
  return {
    turns: db.select({ ...getTableColumns(runTurns),
      promptContent: sql<string | null>`NULL`, responseContent: sql<string | null>`NULL`,
      metadataJson: sql<string | null>`CASE WHEN length(${runTurns.metadataJson}) <= 32768 THEN ${runTurns.metadataJson} ELSE NULL END`,
      changesJson: sql<string | null>`CASE WHEN length(${runTurns.changesJson}) <= 16384 THEN ${runTurns.changesJson} ELSE NULL END`,
    }).from(runTurns).where(and(eq(runTurns.backendId, backendId), eq(runTurns.runId, runId)))
      .orderBy(desc(runTurns.turnIndex)).limit(201),
    artifacts: db.select({ ...getTableColumns(runArtifacts),
      content: sql<string | null>`substr(${runArtifacts.content}, 1, 8192)`,
      metadataJson: sql<string | null>`CASE WHEN length(${runArtifacts.content}) > 8192
        THEN json_set(CASE WHEN json_valid(${metadata}) THEN ${metadata} ELSE '{}' END,
          '$.mobileContentDeferred', json_object('chars', length(${runArtifacts.content}))) ELSE ${metadata} END`,
    }).from(runArtifacts).where(and(eq(runArtifacts.backendId, backendId), eq(runArtifacts.runId, runId)))
      .orderBy(desc(runArtifacts.createdAt), desc(runArtifacts.id)).limit(200),
    calls: db.select({ ...getTableColumns(toolCalls), inputJson: deferredJson(toolCalls.inputJson), outputJson: deferredJson(toolCalls.outputJson),
      metadataJson: sql<string | null>`CASE WHEN length(${toolCalls.metadataJson}) <= 16384 THEN ${toolCalls.metadataJson} ELSE NULL END`,
      error: sql<string | null>`substr(${toolCalls.error}, 1, 8192)`,
    }).from(toolCalls).where(and(eq(toolCalls.backendId, backendId), eq(toolCalls.runId, runId)))
      .orderBy(desc(toolCalls.createdAt), desc(toolCalls.id)).limit(200),
  };
}
