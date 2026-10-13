// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsumptionReport, ConsumptionTotals, DashboardConsumptionData, DashboardData, UsageTotals } from "@mains/contracts/stats";

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(), consumption: vi.fn(), consumptionRefetch: vi.fn(), refetch: vi.fn(),
}));
vi.mock("@/lib/redux/api", () => ({
  useGetDashboardQuery: mocks.dashboard,
  useGetConsumptionQuery: mocks.consumption,
}));
vi.mock("@/lib/platform", () => ({ useIsMobile: () => false }));

import DashboardPage from "./dashboard-page";
import SummaryCards from "./summary-cards";
import TokenActivityChart from "./token-activity-chart";
import HourDistributionChart from "./hour-distribution-chart";
import ToolUsageChart from "./tool-usage-chart";
import * as dashboardFormat from "../lib/dashboard-format";

function emptyUsage(): UsageTotals {
  return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    totalTokens: null, estimatedCostUsd: null, durationMs: null,
    completedTurns: 2, tokenReportedTurns: 0, costReportedTurns: 0 };
}
function dashboard(): DashboardData {
  const tokenActivity = Array.from({ length: 7 }, (_, index) => ({ ...emptyUsage(), completedTurns: index === 6 ? 2 : 0, date: `2026-10-${String(index + 5).padStart(2, "0")}` }));
  return {
    range: { period: "week", timeZone: "Europe/Istanbul", startDate: "2026-10-05", endDate: "2026-10-11", granularity: "day" },
    summary: { ...emptyUsage(), totalSessions: 1, totalTurns: 2 },
    tokenUsage: tokenActivity, tokenActivity,
    providerUsage: [{ ...emptyUsage(), providerId: "cursor", turns: 2 }],
    modelUsage: [{ ...emptyUsage(), providerId: "cursor", model: null, turns: 2 }],
    dailyActivity: [], hourDistribution: [], toolUsage: [], recentSessions: [],
    statusBreakdown: { days: [], totalSucceeded: 0, totalFailed: 0, totalCanceled: 0, totalOther: 0 },
  };
}

function consumption(): DashboardConsumptionData {
  const totals = (tokens: number): ConsumptionTotals => ({
    inputTokens: tokens - 20, uncachedInputTokens: tokens - 60, outputTokens: 20,
    cacheReadTokens: 40, cacheWriteTokens: null, totalTokens: tokens,
    estimatedCostUsd: 8, cacheSavingsUsd: 4, records: 1, tokenReportedRecords: 1,
    costEstimatedRecords: 1, cacheSavingsEstimatedRecords: 1, providerReportedCostRecords: 0, sessions: 1,
    reportedMetrics: { inputTokens: 1, uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 1,
      cacheWriteTokens: 0, totalTokens: 1, estimatedCostUsd: 1, cacheSavingsUsd: 1 },
  });
  const report = (tokens: number): ConsumptionReport => ({ totals: totals(tokens),
    providers: [{ ...totals(tokens), providerId: "codex", model: null }],
    models: [{ ...totals(tokens), providerId: "codex", model: "gpt-6.1-sol" }],
    buckets: [{ ...totals(tokens), date: "2026-10-11", providers: [{ ...totals(tokens), providerId: "codex", model: null }] }],
  });
  return { range: dashboard().range, scannedAt: "2026-10-11T12:00:00Z", cli: report(1000), mains: report(100),
    sources: [{ providerId: "codex", directories: ["/example/.codex/sessions"], status: "available", scannedFiles: 1, unreadableFiles: 0, skippedLines: 0 }],
    pricing: { status: "fresh", source: "https://example.com/prices", fetchedAt: "2026-10-11T00:00:00Z" } };
}

function selectScope(scope: "CLI" | "Mains") {
  fireEvent.click(within(screen.getByRole("tablist", { name: "Dashboard scope" })).getByRole("tab", { name: scope }));
}

describe("consumption dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    mocks.dashboard.mockReturnValue({ currentData: dashboard(), isFetching: false, isError: false, refetch: mocks.refetch });
    mocks.consumption.mockReturnValue({ currentData: undefined, isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps missing usage visible as No data, and preserves a real measured zero", () => {
    const summary = dashboard().summary;
    const view = render(<SummaryCards summary={summary} />);
    expect(screen.getAllByRole("heading", { name: "No data" })).toHaveLength(2);
    expect(screen.queryByText("$0.00")).toBeNull();
    view.rerender(<SummaryCards summary={{ ...summary, totalTokens: 0, estimatedCostUsd: 0, tokenReportedTurns: 1, costReportedTurns: 1 }} />);
    expect(screen.getByRole("heading", { name: "0" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeTruthy();
    expect(screen.getByLabelText("Tokens: 0").getAttribute("title")).toBe("1 of 2 completed turns reported");
    expect(screen.getByLabelText("API estimate: $0.00").getAttribute("title")).toBe("1 of 2 completed turns reported");
  });

  it("shows calendar-aligned columns with keyboard-accessible missing-data explanations", () => {
    const data = dashboard();
    render(<TokenActivityChart data={data.tokenActivity} range={data.range} />);
    expect(screen.getAllByRole("button")).toHaveLength(7);
    const missing = screen.getByRole("button", { name: /Oct 11, 2026 · Token usage not reported · 2 completed turns/ });
    fireEvent.focus(missing);
    expect(screen.getByText("Oct 11, 2026 · No data")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Oct 5, 2026 · No completed turns" })).toBeTruthy();
  });

  it("does not rebuild the yearly calendar's date labels when focusing another day", () => {
    const data = dashboard();
    const range = { ...data.range, period: "year" as const, granularity: "month" as const, startDate: "2025-11-01" };
    const days = Array.from({ length: 345 }, (_, index) => ({ ...emptyUsage(),
      date: new Date(Date.UTC(2025, 10, index + 1)).toISOString().slice(0, 10) }));
    const format = vi.spyOn(dashboardFormat, "formatBucketDate");
    try {
      render(<TokenActivityChart data={days} range={range} />);
      const day = screen.getByRole("button", { name: /Nov 1, 2025/ });
      format.mockClear();
      fireEvent.focus(day);
      expect(format.mock.calls.length).toBeLessThanOrEqual(2);
    } finally { format.mockRestore(); }
  });

  it("shows exact hour counts on focus, including an hour with zero activity", () => {
    render(<HourDistributionChart timeZone="Europe/Istanbul" data={[{ hour: 23, count: 9 }, { hour: 1, count: 4 }]} />);
    expect(screen.getByText("23:00–00:00")).toBeTruthy();
    fireEvent.focus(screen.getByRole("button", { name: "01:00 · 4 turns" }));
    expect(screen.getByText("01:00–02:00")).toBeTruthy();
    fireEvent.focus(screen.getByRole("button", { name: "00:00 · 0 turns" }));
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("uses tool icons and readable names for built-in and MCP tools without truncating raw ids into chart labels", () => {
    render(<ToolUsageChart data={[{ toolName: "Bash", count: 10 }, { toolName: "mcp__cua_repl__js", count: 8 }, { toolName: "CheckPackage", count: 3 }]} />);
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByText("Computer use")).toBeTruthy();
    expect(screen.getByText("Packages")).toBeTruthy();
    expect(screen.getByLabelText("Terminal: 10 calls").querySelector("svg")).toBeTruthy();
    expect(screen.getByLabelText("Computer use: 8 calls").getAttribute("title")).toBe("mcp__cua_repl__js");
  });

  it("renders arbitrary tool names without using inherited label-map properties", () => {
    render(<ToolUsageChart data={[{ toolName: "constructor", count: 1 }, { toolName: "mcp__mains__constructor", count: 2 }]} />);
    expect(screen.getByText("Constructor")).toBeTruthy();
    expect(screen.getByText("Mains")).toBeTruthy();
  });

  it.each([
    ["null response", null],
    ["missing successful response", undefined],
    ["missing summary", { ...dashboard(), summary: null }],
    ["invalid date range", { ...dashboard(), range: { ...dashboard().range, startDate: "invalid" } }],
    ["invalid bucket date", { ...dashboard(), tokenActivity: [{ ...emptyUsage(), date: "2026-02-30" }] }],
    ["invalid hour", { ...dashboard(), hourDistribution: [{ hour: 24, count: 1 }] }],
    ["sparse hour array", { ...dashboard(), hourDistribution: new Array(24) }],
    ["oversized date range", { ...dashboard(), range: { ...dashboard().range, startDate: "0001-01-01" } }],
    ["invalid tool row", { ...dashboard(), toolUsage: [{ toolName: null, count: 1 }] }],
    ["missing status totals", { ...dashboard(), statusBreakdown: {} }],
    ["non-finite usage", { ...dashboard(), summary: { ...dashboard().summary, totalTokens: Infinity } }],
  ])("keeps filters and retry available for malformed Mains data: %s", (_name, payload) => {
    mocks.dashboard.mockReturnValue({ currentData: payload, isSuccess: true, isFetching: false, isError: false, refetch: mocks.refetch });
    render(<DashboardPage />);
    selectScope("Mains");
    expect(screen.getByRole("alert").textContent).toContain("Failed to load dashboard data.");
    expect(screen.getByRole("radiogroup", { name: "Dashboard period" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Loading dashboard")).toBeNull();
  });

  it.each([
    ["null response", null],
    ["missing successful response", undefined],
    ["missing CLI report", { ...consumption(), cli: null }],
    ["missing coverage counts", { ...consumption(), cli: { ...consumption().cli, totals: { ...consumption().cli.totals, reportedMetrics: null } } }],
    ["null bucket", { ...consumption(), cli: { ...consumption().cli, buckets: [null] } }],
    ["sparse source array", { ...consumption(), sources: new Array(2) }],
    ["invalid model name", { ...consumption(), cli: { ...consumption().cli, models: [{ ...consumption().cli.models[0], model: {} }] } }],
    ["unknown source status", { ...consumption(), sources: [{ ...consumption().sources[0], status: "new-status" }] }],
    ["invalid directory", { ...consumption(), sources: [{ ...consumption().sources[0], directories: [{}] }] }],
    ["missing pricing", { ...consumption(), pricing: null }],
  ])("contains malformed CLI data without blocking the Mains tab: %s", (_name, payload) => {
    mocks.consumption.mockReturnValue({ currentData: payload, isSuccess: true, isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    render(<DashboardPage />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load CLI history and API estimates.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh CLI history" }));
    expect(mocks.consumptionRefetch).toHaveBeenCalledOnce();
    selectScope("Mains");
    expect(screen.getByText("Token activity")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps cached CLI totals visible when a background refresh fails", () => {
    mocks.consumption.mockReturnValue({ currentData: consumption(), isFetching: false, isError: true, refetch: mocks.consumptionRefetch });
    render(<DashboardPage />);
    expect(screen.getByRole("alert").textContent).toContain("Could not refresh CLI history");
    expect(screen.getByRole("table", { name: "CLI consumption table" })).toBeTruthy();
    expect(screen.queryByLabelText("Loading CLI consumption")).toBeNull();
  });

  it("does not render a previous filter's data while a newer filter is loading or an older response arrives", () => {
    const view = render(<DashboardPage />);
    selectScope("Mains");
    fireEvent.click(screen.getByRole("radio", { name: "Year" }));
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    mocks.dashboard.mockReturnValue({ currentData: undefined, data: dashboard(), isSuccess: true, isFetching: true, isError: false, refetch: mocks.refetch });
    view.rerender(<DashboardPage />);
    expect(screen.queryByText("Token activity")).toBeNull();
    expect(screen.getByLabelText("Loading dashboard")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    selectScope("CLI");
    selectScope("Mains");
    expect(screen.getByLabelText("Loading dashboard")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Year" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Codex" }).getAttribute("aria-checked")).toBe("true");
  });

  it("recovers from malformed data when a later retry returns a valid response", () => {
    mocks.dashboard.mockReturnValue({ currentData: {}, isSuccess: true, isFetching: false, isError: false, refetch: mocks.refetch });
    const view = render(<DashboardPage />);
    selectScope("Mains");
    expect(screen.getByRole("alert")).toBeTruthy();
    mocks.dashboard.mockReturnValue({ currentData: dashboard(), isSuccess: true, isFetching: false, isError: false, refetch: mocks.refetch });
    view.rerender(<DashboardPage />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Token activity")).toBeTruthy();
  });

  it("sends period, provider and client time zone together and retains controls during loading", () => {
    const view = render(<DashboardPage />);
    expect(mocks.consumption.mock.lastCall?.[0]).toMatchObject({ period: "month", provider: "all", timeZone: expect.any(String) });
    expect(mocks.dashboard.mock.lastCall?.[1]).toMatchObject({ pollingInterval: 0 });
    expect(mocks.consumption.mock.lastCall?.[1]).toMatchObject({ pollingInterval: 60_000 });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Dashboard period" })).getByRole("radio", { name: "Year" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Dashboard provider" })).getByRole("radio", { name: "Codex" }));
    expect(mocks.consumption.mock.lastCall?.[0]).toMatchObject({ period: "year", provider: "codex" });
    selectScope("Mains");
    expect(mocks.dashboard.mock.lastCall?.[0]).toMatchObject({ period: "year", provider: "codex" });
    expect(mocks.dashboard.mock.lastCall?.[1]).toMatchObject({ pollingInterval: 30_000 });
    expect(mocks.consumption.mock.lastCall?.[1]).toMatchObject({ pollingInterval: 0 });
    expect(screen.getByRole("radio", { name: "Year" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Codex" }).getAttribute("aria-checked")).toBe("true");
    mocks.dashboard.mockReturnValue({ currentData: undefined, data: dashboard(), isFetching: true, isError: false, refetch: mocks.refetch });
    view.rerender(<DashboardPage />);
    expect(screen.getByRole("radiogroup", { name: "Dashboard period" })).toBeTruthy();
    expect(screen.queryByText("Token activity")).toBeNull();
    expect(screen.getByLabelText("Loading dashboard")).toBeTruthy();
    expect(screen.queryByText("Updating…")).toBeNull();
  });

  it("offers a retry on history errors without hiding the filters", () => {
    mocks.dashboard.mockReturnValue({ isError: true, isFetching: false, refetch: mocks.refetch });
    render(<DashboardPage />);
    selectScope("Mains");
    expect(screen.getByRole("alert").textContent).toContain("Failed to load dashboard data.");
    expect(screen.getByRole("radiogroup", { name: "Dashboard provider" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("switches between distinct CLI and Mains panels with always-open breakdowns and matching columns", () => {
    mocks.consumption.mockReturnValue({ currentData: consumption(), isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    render(<DashboardPage />);
    expect(screen.getByRole("tabpanel", { name: "CLI" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "CLI breakdown" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "CLI breakdown" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Usage recorded in Mains" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Mains consumption table" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Session success rate" })).toBeNull();
    const cli = screen.getByRole("table", { name: "CLI consumption table" });
    expect(within(cli).getAllByText("1K")).toHaveLength(2);
    expect(screen.queryByText("1.1K")).toBeNull();
    const expectConsumptionColumns = (table: HTMLElement) => {
      expect(within(table).getByRole("columnheader", { name: "Cache savings" })).toBeTruthy();
      expect(within(table).getByRole("columnheader", { name: "API cost" })).toBeTruthy();
      expect(within(table).getAllByText("$4.00")).toHaveLength(2);
      expect(within(table).getAllByText("No data")).toHaveLength(2);
    };
    expectConsumptionColumns(cli);

    selectScope("Mains");
    expect(screen.getByRole("tabpanel", { name: "Mains" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Session success rate" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Claude and Codex CLI history" })).toBeNull();
    expect(screen.queryByRole("table", { name: "CLI consumption table" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Mains breakdown" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mains breakdown" })).toBeNull();
    const mains = screen.getByRole("table", { name: "Mains consumption table" });
    expect(within(mains).getAllByText("100")).toHaveLength(2);
    expectConsumptionColumns(mains);
    expect(screen.getByLabelText("Sessions: 1").getAttribute("title")).toBe("Active in the selected period");
    expect(screen.queryByText("In-app usage")).toBeNull();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Mains" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tabpanel", { name: "CLI" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Mains consumption table" })).toBeNull();
    expect(screen.getByRole("table", { name: "CLI consumption table" })).toBeTruthy();
    expect(mocks.dashboard.mock.lastCall?.[1]).toMatchObject({ pollingInterval: 0 });
  });

  it("keeps the Mains comparison visible when CLI history has no records", () => {
    const data = consumption();
    data.cli = { ...data.cli, providers: [], models: [], buckets: [], totals: { ...data.cli.totals,
      records: 0, sessions: 0, totalTokens: null, estimatedCostUsd: null, cacheSavingsUsd: null } };
    mocks.consumption.mockReturnValue({ currentData: data, isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    render(<DashboardPage />);
    expect(within(screen.getByRole("table", { name: "CLI consumption table" })).getByText("No recorded consumption in this period.")).toBeTruthy();
    expect(screen.getByText("No token usage available")).toBeTruthy();
    selectScope("Mains");
    expect(within(screen.getByRole("table", { name: "Mains consumption table" })).getAllByText("100")).toHaveLength(2);
    expect(screen.getByText("Token activity")).toBeTruthy();
  });

  it("switches model breakdown and cost charts within the CLI scope", () => {
    mocks.consumption.mockReturnValue({ currentData: consumption(), isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    render(<DashboardPage />);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "CLI consumption breakdown" })).getByRole("radio", { name: "Model" }));
    const model = within(screen.getByRole("table", { name: "CLI consumption table" })).getByText("GPT 6.1 Sol");
    expect(model.getAttribute("title")).toContain("gpt-6.1-sol");
    expect(screen.getByRole("table", { name: "CLI consumption table" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "CLI chart metric" })).getByRole("radio", { name: "Cost" }));
    const point = screen.getByRole("button", { name: /Oct 11, 2026 · \$8.00 API estimate/ });
    fireEvent.focus(point);
    expect(screen.getByText("Sun · $8.00")).toBeTruthy();
    selectScope("Mains");
    expect(within(screen.getByRole("table", { name: "Mains consumption table" })).queryByText("GPT 6.1 Sol")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "CLI chart metric" })).toBeNull();
  });

  it("retains each visited scope's chart and breakdown state without mounting it again", () => {
    mocks.consumption.mockReturnValue({ currentData: consumption(), isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    render(<DashboardPage />);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "CLI chart metric" })).getByRole("radio", { name: "Cost" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "CLI consumption breakdown" })).getByRole("radio", { name: "Model" }));
    const cliTable = screen.getByRole("table", { name: "CLI consumption table" });
    selectScope("Mains");
    const mainsTable = screen.getByRole("table", { name: "Mains consumption table" });
    selectScope("CLI");
    expect(screen.getByRole("radio", { name: "Cost" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("table", { name: "CLI consumption table" })).toBe(cliTable);
    expect(within(cliTable).getByText("GPT 6.1 Sol")).toBeTruthy();
    selectScope("Mains");
    expect(screen.getByRole("table", { name: "Mains consumption table" })).toBe(mainsTable);
  });

  it("does not hide Mains activity when the separate CLI scan fails", () => {
    mocks.consumption.mockReturnValue({ isError: true, isFetching: false, refetch: mocks.consumptionRefetch });
    render(<DashboardPage />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load CLI history and API estimates.");
    expect(screen.queryByText("Token activity")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh CLI history" }));
    expect(mocks.consumptionRefetch).toHaveBeenCalledOnce();
    expect(mocks.refetch).not.toHaveBeenCalled();
    selectScope("Mains");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Token activity")).toBeTruthy();
  });

  it("keeps the shared date range steady and refreshes loaded Mains content without an updating row", () => {
    mocks.consumption.mockReturnValue({ currentData: consumption(), isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    mocks.dashboard.mockReturnValue({ currentData: undefined, isFetching: true, isError: false, refetch: mocks.refetch });
    const view = render(<DashboardPage />);
    const dateRange = screen.getByText("Oct 5 – Oct 11, 2026");
    selectScope("Mains");
    expect(screen.getByText("Oct 5 – Oct 11, 2026")).toBe(dateRange);
    expect(screen.queryByText("Updating…")).toBeNull();

    mocks.dashboard.mockReturnValue({ currentData: dashboard(), isFetching: false, isError: false, refetch: mocks.refetch });
    view.rerender(<DashboardPage />);
    const sessions = screen.getByLabelText("Sessions: 1");
    mocks.dashboard.mockReturnValue({ currentData: dashboard(), isFetching: true, isError: false, refetch: mocks.refetch });
    view.rerender(<DashboardPage />);
    expect(screen.getByLabelText("Sessions: 1")).toBe(sessions);
    expect(screen.queryByLabelText("Loading dashboard")).toBeNull();
    expect(screen.queryByText("Updating…")).toBeNull();

    selectScope("CLI");
    selectScope("Mains");
    expect(screen.getByText("Token activity")).toBeTruthy();
    expect(screen.queryByLabelText("Loading dashboard")).toBeNull();
    expect(screen.getByText("Oct 5 – Oct 11, 2026")).toBe(dateRange);
  });

  it("opens sources and pricing from the history info action and dismisses the dialog", () => {
    mocks.consumption.mockReturnValue({ currentData: consumption(), isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    render(<DashboardPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sources & pricing" })).toBeNull();
    expect(screen.queryByText("/example/.codex/sessions")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sources & pricing" }));
    const dialog = screen.getByRole("dialog", { name: "Sources & pricing" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("/example/.codex/sessions")).toBeTruthy();
    expect(within(dialog).getByText("1 file scanned")).toBeTruthy();
    expect(within(dialog).getByText("LiteLLM base model prices")).toBeTruthy();
    expect(dialog.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-11T00:00:00Z");
    expect(within(dialog).getByText("No data & *")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close sources & pricing" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sources & pricing" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.consumptionRefetch).not.toHaveBeenCalled();
  });

  it("keeps scan issues and missing pricing timestamps readable without inventing dates", () => {
    const data = consumption();
    data.sources[0] = { ...data.sources[0], status: "partial", skippedLines: 26 };
    data.pricing = { ...data.pricing, status: "cached", fetchedAt: null };
    mocks.consumption.mockReturnValue({ currentData: data, isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    const view = render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sources & pricing" }));
    const dialog = screen.getByRole("dialog", { name: "Sources & pricing" });
    expect(within(dialog).getByText("Partial scan")).toBeTruthy();
    expect(within(dialog).getByText("26 skipped lines")).toBeTruthy();
    expect(within(dialog).queryByText(/unreadable files/)).toBeNull();
    expect(within(dialog).getByText("Cached prices")).toBeTruthy();
    expect(within(dialog).getByText("Update time unavailable")).toBeTruthy();
    expect(dialog.querySelector("time")).toBeNull();

    mocks.consumption.mockReturnValue({ currentData: { ...data, pricing: { ...data.pricing, status: "unavailable" } }, isFetching: false, isError: false, refetch: mocks.consumptionRefetch });
    view.rerender(<DashboardPage />);
    expect(within(dialog).getByText("Unavailable")).toBeTruthy();
    expect(within(dialog).getByText("Token history is still included. Unpriced estimates show No data.")).toBeTruthy();
    expect(screen.getByRole("table", { name: "CLI consumption table" })).toBeTruthy();
  });
});
