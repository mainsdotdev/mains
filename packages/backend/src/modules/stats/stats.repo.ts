import { sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { runs, runTurns, workspaces, projects, toolCalls } from "../../db/schema";
import type { ResolvedDashboardRange } from "./stats.range";

export interface ActivityRow {
  runId: string;
  title: string | null;
  goal: string | null;
  status: string;
  providerId: string;
  projectName: string | null;
  activityAt: number;
  turnId: number | null;
  turnStatus: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costMicros: number | null;
  elapsedMs: number | null;
  model: string | null;
  modelUsage: string | null;
}

export const statsRepo = {
  async listActivityRows(range: ResolvedDashboardRange): Promise<ActivityRow[]> {
    const provider = range.provider === "all" ? sql`1=1` : sql`r.provider_id = ${range.provider}`;
    return getDb().all<ActivityRow>(sql`
      SELECT r.id AS runId, r.title, r.goal, r.status, r.provider_id AS providerId,
        p.name AS projectName,
        COALESCE(t.started_at, t.created_at, r.created_at) AS activityAt,
        t.id AS turnId, t.status AS turnStatus,
        t.input_tokens AS inputTokens, t.output_tokens AS outputTokens,
        t.cache_read_tokens AS cacheReadTokens, t.cache_write_tokens AS cacheWriteTokens,
        t.cost_micros AS costMicros, t.elapsed_ms AS elapsedMs,
        t.model, t.model_usage AS modelUsage
      FROM ${runs} r
      LEFT JOIN ${runTurns} t ON t.run_id = r.id
      LEFT JOIN ${workspaces} w ON w.id = r.workspace_id
      LEFT JOIN ${projects} p ON p.id = w.project_id
      WHERE COALESCE(t.started_at, t.created_at, r.created_at)
        BETWEEN ${range.fromSeconds} AND ${range.toSeconds} AND ${provider}
    `);
  },

  async listToolRows(range: ResolvedDashboardRange) {
    const provider = range.provider === "all" ? sql`1=1` : sql`r.provider_id = ${range.provider}`;
    return getDb().all<{ toolName: string; activityAt: number }>(sql`
      SELECT tc.tool_name AS toolName, COALESCE(tc.started_at, tc.created_at) AS activityAt
      FROM ${toolCalls} tc INNER JOIN ${runs} r ON r.id = tc.run_id
      WHERE COALESCE(tc.started_at, tc.created_at)
        BETWEEN ${range.fromSeconds} AND ${range.toSeconds} AND ${provider}
    `);
  },
};
