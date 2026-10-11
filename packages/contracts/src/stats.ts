import type { ProviderId } from "./provider-ids";

export type ProviderFilter = "all" | ProviderId;
export type DashboardPeriod = "week" | "month" | "year";

export interface DashboardQuery {
  provider?: ProviderFilter;
  period?: DashboardPeriod;
  /** IANA time zone of the client displaying the dashboard. */
  timeZone?: string;
}

export interface DashboardRange {
  period: DashboardPeriod;
  timeZone: string;
  startDate: string;
  endDate: string;
  granularity: "day" | "month";
}

/** Null means unreported; a measured zero remains zero. Only completed turns
 * contribute usage. Input includes cached input on every provider, so caches
 * are a breakdown, never additional tokens on top of totalTokens. */
export interface UsageTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  completedTurns: number;
  tokenReportedTurns: number;
  costReportedTurns: number;
}

export interface DashboardSummary extends UsageTotals {
  totalSessions: number;
  totalTurns: number;
}

export interface TokenUsageBucket extends UsageTotals {
  /** YYYY-MM-DD, first day of the month for monthly buckets. */
  date: string;
}

export interface ProviderUsage extends UsageTotals {
  providerId: string;
  turns: number;
}

export interface ModelUsage extends UsageTotals {
  providerId: string;
  /** Recorded model id; never resolved against today's aliases. */
  model: string | null;
  turns: number;
}

export interface DailyActivity {
  date: string;
  claude: number;
  copilot: number;
  codex: number;
  cursor: number;
  other: number;
}

export interface HourDistribution {
  hour: number;
  count: number;
}

export interface ToolUsageItem {
  toolName: string;
  count: number;
}

export interface StatusBreakdownDay {
  date: string;
  succeeded: number;
  failed: number;
  canceled: number;
  other: number;
}

/** Current status of sessions active in the selected period, each counted once
 * at its most recent activity. This is not a historical turn success rate. */
export interface StatusBreakdown {
  days: StatusBreakdownDay[];
  totalSucceeded: number;
  totalFailed: number;
  totalCanceled: number;
  totalOther: number;
}

export interface RecentSession extends UsageTotals {
  runId: string;
  title: string | null;
  goal: string | null;
  status: string;
  providerId: string;
  projectName: string | null;
  lastActivityAt: number;
}

export interface DashboardData {
  range: DashboardRange;
  summary: DashboardSummary;
  tokenUsage: TokenUsageBucket[];
  /** Daily client-calendar usage, including when the main chart is monthly. */
  tokenActivity: TokenUsageBucket[];
  providerUsage: ProviderUsage[];
  modelUsage: ModelUsage[];
  dailyActivity: DailyActivity[];
  hourDistribution: HourDistribution[];
  toolUsage: ToolUsageItem[];
  statusBreakdown: StatusBreakdown;
  recentSessions: RecentSession[];
}

/** CLI transcripts and Mains turns overlap. These reports are separate scopes,
 * never additive. Unknown measurements and prices remain null. */
export type ConsumptionMetric = "inputTokens" | "uncachedInputTokens" | "outputTokens" | "cacheReadTokens"
  | "cacheWriteTokens" | "totalTokens" | "estimatedCostUsd" | "cacheSavingsUsd";

export interface ConsumptionTotals {
  inputTokens: number | null;
  uncachedInputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  cacheSavingsUsd: number | null;
  records: number;
  tokenReportedRecords: number;
  costEstimatedRecords: number;
  cacheSavingsEstimatedRecords: number;
  providerReportedCostRecords: number;
  sessions: number;
  reportedMetrics: Record<ConsumptionMetric, number>;
}

export interface ConsumptionRow extends ConsumptionTotals {
  providerId: string;
  model: string | null;
}

export interface ConsumptionBucket extends ConsumptionTotals {
  date: string;
  providers: ConsumptionRow[];
}

export interface ConsumptionReport {
  totals: ConsumptionTotals;
  providers: ConsumptionRow[];
  models: ConsumptionRow[];
  buckets: ConsumptionBucket[];
}

export interface CliHistorySource {
  providerId: "claude_code" | "codex";
  directories: string[];
  status: "available" | "missing" | "partial" | "error";
  scannedFiles: number;
  unreadableFiles: number;
  skippedLines: number;
}

export interface UsagePricingStatus {
  status: "fresh" | "cached" | "unavailable";
  source: string;
  fetchedAt: string | null;
}

export interface DashboardConsumptionData {
  range: DashboardRange;
  scannedAt: string;
  cli: ConsumptionReport;
  mains: ConsumptionReport;
  sources: CliHistorySource[];
  pricing: UsagePricingStatus;
}
