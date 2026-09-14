import { sql, eq, count } from "drizzle-orm";
import { getDb } from "../../db/client";
import {
  runTurns,
  runs,
  projects,
  workspaces,
  toolCalls,
  workspaceDiffs,
} from "../../db/schema";
import type {
  DashboardSummary,
  DailyActivity,
  HourDistribution,
  CostByModel,
  ToolUsageItem,
  StatusBreakdown,
  RecentSession,
  CodeActivityStats,
  ProviderFilter,
} from "./stats.dto";
import { PROVIDER_IDS } from "../../../shared/provider-ids";

function providerWhere(filter: ProviderFilter) {
  if (filter === "all") return sql`1=1`;
  return sql`${runs.providerId} = ${filter}`;
}

function providerWhereTurns(filter: ProviderFilter) {
  if (filter === "all") return sql`1=1`;
  return sql`r.provider_id = ${filter}`;
}

export const statsRepo = {
  async getSummary(filter: ProviderFilter = "all"): Promise<DashboardSummary> {
    const db = getDb();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = Math.floor(todayStart.getTime() / 1000);

    const [projectCount] = await db
      .select({ count: count() })
      .from(projects)
      .where(eq(projects.isArchived, false));

    const pw = providerWhere(filter);

    const [runsToday] = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM ${runs}
      WHERE ${runs.createdAt} >= ${todayTs} AND ${pw}
    `);

    const [totalSessions] = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM ${runs} WHERE ${pw}
    `);

    // Sum cost from all completed turns — copilot excluded (cost calculation not yet implemented)
    const ptw = providerWhereTurns(filter);
    const [costResult] = await db.all<{ total: number }>(sql`
      SELECT COALESCE(SUM(${runTurns.costMicros}), 0) AS total
      FROM ${runTurns}
      INNER JOIN ${runs} r ON r.id = ${runTurns.runId}
      WHERE ${runTurns.status} = 'completed' AND r.provider_id != ${PROVIDER_IDS.copilot} AND ${ptw}
    `);

    return {
      totalProjects: projectCount?.count ?? 0,
      runsToday: runsToday?.count ?? 0,
      totalSessions: totalSessions?.count ?? 0,
      estimatedCostUsd: (costResult?.total ?? 0) / 1_000_000,
    };
  },

  async getDailyActivity(days: number = 30, filter: ProviderFilter = "all"): Promise<DailyActivity[]> {
    const db = getDb();
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const pw = providerWhere(filter);

    const rows = await db.all<{
      date: string;
      provider_id: string;
      count: number;
    }>(sql`
      SELECT
        date(${runs.createdAt}, 'unixepoch') AS date,
        ${runs.providerId} AS provider_id,
        COUNT(*) AS count
      FROM ${runs}
      WHERE ${runs.createdAt} >= ${Math.floor(since.getTime() / 1000)} AND ${pw}
      GROUP BY date, provider_id
      ORDER BY date ASC
    `);

    const dayMap = new Map<string, DailyActivity>();
    for (const row of rows) {
      if (!dayMap.has(row.date)) {
        dayMap.set(row.date, { date: row.date, claude: 0, copilot: 0, codex: 0, cursor: 0, other: 0 });
      }
      const day = dayMap.get(row.date)!;
      if (row.provider_id === PROVIDER_IDS.claude) {
        day.claude += row.count;
      } else if (row.provider_id === PROVIDER_IDS.copilot) {
        day.copilot += row.count;
      } else if (row.provider_id === PROVIDER_IDS.codex) {
        day.codex += row.count;
      } else if (row.provider_id === PROVIDER_IDS.cursor) {
        day.cursor += row.count;
      } else {
        day.other += row.count;
      }
    }

    return Array.from(dayMap.values());
  },

  async getHourDistribution(filter: ProviderFilter = "all"): Promise<HourDistribution[]> {
    const db = getDb();
    const pw = providerWhere(filter);
    const rows = await db.all<{ hour: number; count: number }>(sql`
      SELECT
        CAST(strftime('%H', ${runs.createdAt}, 'unixepoch', 'localtime') AS INTEGER) AS hour,
        COUNT(*) AS count
      FROM ${runs}
      WHERE ${pw}
      GROUP BY hour
      ORDER BY hour ASC
    `);
    return rows;
  },

  async getCostByModel(filter: ProviderFilter = "all"): Promise<CostByModel[]> {
    const db = getDb();

    // Extract per-model costs from runTurns.model_usage JSON
    // Each turn has model_usage: { "model-name": { costUSD, ... }, ... }
    const ptw = providerWhereTurns(filter);
    const rows = await db.all<{
      model_name: string;
      cost_micros: number;
      turn_count: number;
    }>(sql`
      SELECT
        j.key AS model_name,
        COALESCE(SUM(CAST(json_extract(j.value, '$.costUSD') * 1000000 AS INTEGER)), 0) AS cost_micros,
        COUNT(*) AS turn_count
      FROM ${runTurns} t
      INNER JOIN ${runs} r ON r.id = t.run_id
      , json_each(t.model_usage) j
      WHERE t.status = 'completed'
        AND t.model_usage IS NOT NULL
        AND r.provider_id != ${PROVIDER_IDS.copilot}
        AND ${ptw}
      GROUP BY j.key
      ORDER BY cost_micros DESC
    `);

    return rows
      .map((r) => ({
        model: r.model_name,
        costUsd: r.cost_micros / 1_000_000,
        runs: r.turn_count,
      }))
      .filter((r) => r.costUsd > 0);
  },

  async getToolUsage(limit: number = 10, filter: ProviderFilter = "all"): Promise<ToolUsageItem[]> {
    const db = getDb();
    const pw = filter === "all" ? sql`1=1` : sql`r.provider_id = ${filter}`;
    const rows = await db.all<{ tool_name: string; count: number }>(sql`
      SELECT
        ${toolCalls.toolName} AS tool_name,
        COUNT(*) AS count
      FROM ${toolCalls}
      INNER JOIN ${runs} r ON r.id = ${toolCalls.runId}
      WHERE ${pw}
      GROUP BY tool_name
      ORDER BY count DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      toolName: r.tool_name,
      count: r.count,
    }));
  },

  async getStatusBreakdown(filter: ProviderFilter = "all"): Promise<StatusBreakdown> {
    const db = getDb();
    const pw = providerWhere(filter);
    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const rows = await db.all<{
      date: string;
      status: string;
      count: number;
    }>(sql`
      SELECT
        date(${runs.createdAt}, 'unixepoch') AS date,
        ${runs.status} AS status,
        COUNT(*) AS count
      FROM ${runs}
      WHERE ${pw}
      GROUP BY date, status
      ORDER BY date ASC
    `);

    // Group by date
    const dayMap = new Map<string, { succeeded: number; failed: number; canceled: number; other: number }>();
    for (const row of rows) {
      if (!dayMap.has(row.date)) {
        dayMap.set(row.date, { succeeded: 0, failed: 0, canceled: 0, other: 0 });
      }
      const day = dayMap.get(row.date)!;
      if (row.status === "succeeded" || row.status === "completed") {
        day.succeeded += row.count;
      } else if (row.status === "failed") {
        day.failed += row.count;
      } else if (row.status === "canceled") {
        day.canceled += row.count;
      } else {
        day.other += row.count;
      }
    }

    // Take last 7 days that have data
    const allDates = Array.from(dayMap.keys()).sort();
    const recentDates = allDates.slice(-7);

    const days = recentDates.map((dateStr) => {
      const d = new Date(dateStr + "T00:00:00");
      const entry = dayMap.get(dateStr)!;
      return {
        date: dateStr,
        dayLabel: DAY_LABELS[d.getDay()],
        ...entry,
      };
    });

    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalCanceled = 0;
    let totalOther = 0;
    for (const day of days) {
      totalSucceeded += day.succeeded;
      totalFailed += day.failed;
      totalCanceled += day.canceled;
      totalOther += day.other;
    }

    return { days, totalSucceeded, totalFailed, totalCanceled, totalOther };
  },

  async getRecentSessions(limit: number = 15, filter: ProviderFilter = "all"): Promise<RecentSession[]> {
    const db = getDb();
    const pw = filter === "all" ? sql`1=1` : sql`r.provider_id = ${filter}`;
    const rows = await db.all<{
      run_id: string;
      title: string | null;
      goal: string | null;
      status: string;
      provider_id: string;
      project_name: string | null;
      duration_ms: number | null;
      cost_micros: number | null;
      created_at: number;
    }>(sql`
      SELECT
        r.id AS run_id,
        r.title,
        r.goal,
        r.status,
        r.provider_id,
        p.name AS project_name,
        tc.duration_ms,
        tc.cost_micros,
        r.created_at
      FROM ${runs} r
      LEFT JOIN ${workspaces} w ON w.id = r.workspace_id
      LEFT JOIN ${projects} p ON p.id = w.project_id
      LEFT JOIN (
        SELECT ${runTurns.runId} AS run_id,
               SUM(${runTurns.costMicros}) AS cost_micros,
               SUM(${runTurns.elapsedMs}) AS duration_ms
        FROM ${runTurns}
        WHERE ${runTurns.status} = 'completed'
        GROUP BY ${runTurns.runId}
      ) tc ON tc.run_id = r.id
      WHERE ${pw}
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      runId: r.run_id,
      title: r.title,
      goal: r.goal,
      status: r.status,
      providerId: r.provider_id,
      projectName: r.project_name,
      durationMs: r.duration_ms,
      totalCostUsd: r.provider_id === PROVIDER_IDS.copilot ? null : r.cost_micros != null ? r.cost_micros / 1_000_000 : null,
      createdAt: r.created_at,
    }));
  },

  async getCodeActivity(filter: ProviderFilter = "all"): Promise<CodeActivityStats> {
    const db = getDb();
    const pw = filter === "all" ? sql`1=1` : sql`r.provider_id = ${filter}`;
    const [result] = await db.all<{
      total_diffs: number;
      total_files: number;
    }>(sql`
      SELECT
        COUNT(*) AS total_diffs,
        COALESCE(SUM(
          CASE
            WHEN ${workspaceDiffs.filesJson} IS NOT NULL
            THEN json_array_length(${workspaceDiffs.filesJson})
            ELSE 0
          END
        ), 0) AS total_files
      FROM ${workspaceDiffs}
      INNER JOIN ${runs} r ON r.id = ${workspaceDiffs.runId}
      WHERE ${pw}
    `);

    return {
      totalDiffs: result?.total_diffs ?? 0,
      totalFilesChanged: result?.total_files ?? 0,
    };
  },

};
