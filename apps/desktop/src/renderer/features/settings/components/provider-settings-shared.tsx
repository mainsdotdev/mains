import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AsciiSpinner, Button, Text, toast } from "@/components/ui";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsRow,
} from "./settings-layout";
import {
  useArchiveSpaceMutation,
  useGetProviderByIdQuery,
  useGetSpacesQuery,
  useSetActiveSpaceMutation,
  useUnarchiveSpaceMutation,
  useUpdateProviderMutation,
  useUpdateProviderCliMutation,
} from "@/lib/redux/api";
import type { AccountInfo } from "@/lib/redux/api/providersApi";
import { getSpaceDefaultRoute } from "@/lib/route-utils";
import { extractErrorMessage } from "@/lib/extract-error-message";

type ProviderData = ReturnType<typeof useGetProviderByIdQuery>["data"];

export function useProviderSettings<TConfig extends object = Record<string, unknown>>(
  providerId: string,
  spaceSlug: string,
) {
  const navigate = useNavigate();
  const {
    data: provider,
    isLoading,
    error,
  } = useGetProviderByIdQuery(providerId);
  const [updateProvider, { isLoading: updating }] = useUpdateProviderMutation();
  const { data: spaces = [] } = useGetSpacesQuery();
  const [archiveSpace] = useArchiveSpaceMutation();
  const [unarchiveSpace] = useUnarchiveSpaceMutation();
  const [setActiveSpace] = useSetActiveSpaceMutation();

  const space = spaces.find((s) => s.slug === spaceSlug);
  const otherVisibleSpaces = spaces.filter(
    (s) => s.slug !== spaceSlug && !s.isArchived,
  );
  const canHide = otherVisibleSpaces.length > 0;
  const config = (provider?.config ?? {}) as TConfig;

  const updateConfig = async (patch: Partial<TConfig>) => {
    if (!provider || updating) return false;
    try {
      await updateProvider({
        id: providerId,
        payload: { config: { ...config, ...patch } },
      }).unwrap();
      return true;
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to update setting"));
      return false;
    }
  };

  const setSpaceVisible = async (visible: boolean) => {
    if (!space) return;

    try {
      if (visible) {
        await unarchiveSpace(space.id).unwrap();
        toast.success("Space is now visible");
      } else {
        await archiveSpace(space.id).unwrap();
        const target = otherVisibleSpaces[0];
        if (target) {
          await setActiveSpace(target.id).unwrap();
          const route = getSpaceDefaultRoute(target);
          setTimeout(() => navigate(route, { replace: true }), 0);
        }
        toast.success("Space hidden");
      }
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to update space visibility"));
    }
  };

  return {
    provider,
    isLoading,
    error,
    updating,
    config,
    space,
    canHide,
    updateConfig,
    setSpaceVisible,
  };
}

/**
 * CLI version + self-update section shared by every provider page.
 * Owns the update mutation and result message; per-provider bits come in as
 * props. Extra provider-specific rows (e.g. Cursor's outdated notice) render
 * below the update row via `children`.
 */
export function ProviderCliSection({
  providerId,
  cliName,
  shortName,
  cli,
  buttonVariant = "primary",
  children,
}: {
  providerId: string;
  /** Row title, e.g. "Claude Code CLI". */
  cliName: string;
  /** Used in the success message: "Claude" → "Claude CLI updated." */
  shortName: string;
  cli: AccountInfo["cli"];
  buttonVariant?: "primary" | "secondary";
  children?: ReactNode;
}) {
  const [updateCli, { isLoading: isUpdatingCli }] =
    useUpdateProviderCliMutation();
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  const handleUpdateCli = async () => {
    setUpdateResult(null);
    try {
      const res = await updateCli(providerId).unwrap();
      setUpdateResult(
        res.success ? `${shortName} CLI updated.` : res.output || "Update failed.",
      );
    } catch {
      setUpdateResult("Update failed.");
    }
  };

  return (
    <SettingsSection title="CLI">
      <SettingsRow
        title={cliName}
        description={
          cli?.version
            ? `Version ${cli.version}${cli.channel ? ` · ${cli.channel} channel` : ""}`
            : "Version unknown"
        }
      >
        <div className="flex items-center gap-3">
          {updateResult && (
            <Text as="span" size="xs" tone="subtle">
              {updateResult}
            </Text>
          )}
          <Button
            variant={buttonVariant}
            onClick={handleUpdateCli}
            disabled={isUpdatingCli}
            className="gap-1 flex items-center"
          >
            {isUpdatingCli ? (
              <AsciiSpinner variant="null" kind="download" />
            ) : null}
            {isUpdatingCli ? "Updating…" : "Update CLI"}
          </Button>
        </div>
      </SettingsRow>
      {children}
    </SettingsSection>
  );
}

/**
 * Account section shared by the provider pages. The page decides which
 * account type counts as "signed in" for its provider and passes the resolved
 * row content; this component owns the skeleton / API-key / signed-out states.
 */
export function ProviderAccountSection({
  isLoading,
  signedIn,
  isApiKey = false,
  notSignedInDescription,
}: {
  isLoading: boolean;
  /** Resolved row content when the provider-specific account type matched. */
  signedIn: { title: string; description: string; plan: string } | null;
  /** Providers that support API-key auth (Claude, Codex) pass this branch. */
  isApiKey?: boolean;
  notSignedInDescription: string;
}) {
  return (
    <SettingsSection title="Account">
      {isLoading ? (
        <div className="flex items-center justify-between py-4">
          <div className="flex flex-col gap-1.5">
            <div className="h-4 w-40 rounded bg-primary-200/50 dark:bg-primary-700/30 animate-pulse" />
            <div className="h-3 w-24 rounded bg-primary-200/30 dark:bg-primary-700/20 animate-pulse" />
          </div>
          <div className="h-4 w-12 rounded bg-primary-200/50 dark:bg-primary-700/30 animate-pulse" />
        </div>
      ) : signedIn ? (
        <SettingsRow title={signedIn.title} description={signedIn.description}>
          <Text as="span" weight="medium">
            {signedIn.plan}
          </Text>
        </SettingsRow>
      ) : isApiKey ? (
        <SettingsRow title="Authentication" description="Connected via API key">
          <Text as="span" tone="subtle">
            API Key
          </Text>
        </SettingsRow>
      ) : (
        <SettingsRow title="Not signed in" description={notSignedInDescription}>
          <Text as="span" size="xs" tone="subtle">
            No account
          </Text>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

export function formatResetDate(resetsAt: number): string {
  const date = new Date(resetsAt * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `Resets ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return `Resets ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export interface ProviderUsageRow {
  label: string;
  usedPercent: number;
  resetsAt?: number;
  used?: number;
  total?: number;
}

/**
 * What sits beside the meter: a bare `N% left`, or the provider's own counts
 * (`24 / 200`) when it reports them.
 */
export type UsageReadout = "percentLeft" | "counts";

const USAGE_TICK_COUNT = 24;

/**
 * Tick colour by how much of the window is left — the same quantity the meter
 * draws, so the colour can't disagree with the fill. Half the allowance gone
 * turns it amber, a fifth left turns it red.
 */
function usageLevelClass(remainingPercent: number): string {
  if (remainingPercent <= 20) return "bg-danger";
  if (remainingPercent <= 50) return "bg-warning";
  return "bg-accent";
}

/**
 * Segmented meter: a row of thin ticks, the ones covering what's *left* in the
 * level colour, the rest muted. Rounds to the nearest tick but always lights at
 * least one for a non-zero remainder so a 1% reading isn't drawn empty.
 *
 * The meter reads the same way on every provider — a full row means a full
 * allowance — so it takes consumption and derives the fill itself rather than
 * letting a caller hand it the opposite quantity.
 */
function UsageTicks({
  usedPercent,
  label,
}: {
  usedPercent: number;
  label: string;
}) {
  const clamped = Math.min(100, Math.max(0, 100 - usedPercent));
  const filled =
    clamped === 0
      ? 0
      : Math.max(1, Math.round((clamped / 100) * USAGE_TICK_COUNT));
  const levelClass = usageLevelClass(clamped);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className="flex items-center gap-1.25"
    >
      {Array.from({ length: USAGE_TICK_COUNT }, (_, i) => (
        <span
          key={i}
          className={`h-3.5 w-0.75 rounded-full transition-colors duration-300 ${
            i < filled
              ? levelClass
              : "bg-primary-300/70 dark:bg-primary-600/50"
          }`}
        />
      ))}
    </div>
  );
}

/**
 * One rate-limit row. The meter always draws what's left; `readout` only picks
 * the number beside it — a bare percentage (Codex) or, where a provider reports
 * raw counts, how many of them are left (Copilot's `176 / 200`). The counts read
 * the same direction as the bar: the leading number is the remainder, not the
 * consumption. They fall back to the percentage when the provider didn't send
 * them, so the text never contradicts the bar.
 */
function UsageRateLimitRow({
  row,
  readout,
}: {
  row: ProviderUsageRow;
  readout: UsageReadout;
}) {
  const remaining = 100 - row.usedPercent;
  const hasCounts = typeof row.used === "number" && typeof row.total === "number";
  // Clamped: a provider that reports more used than it entitles (or a snapshot
  // caught mid-reset) shouldn't render a negative remainder.
  const remainingCount = hasCounts ? Math.max(0, row.total! - row.used!) : 0;

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex flex-col gap-0.5">
        <Text as="span" weight="medium">
          {row.label}
        </Text>
        {row.resetsAt && (
          <Text as="span" size="xs" tone="subtle">
            {formatResetDate(row.resetsAt)}
          </Text>
        )}
      </div>
      <div className="flex items-center gap-3">
        <UsageTicks usedPercent={row.usedPercent} label={row.label} />
        {readout === "counts" && hasCounts ? (
          <Text as="span" tone="subtle" align="right" className="w-28 tabular-nums">
            {`${remainingCount.toLocaleString()} / ${row.total!.toLocaleString()}`}
          </Text>
        ) : (
          <Text as="span" tone="subtle" align="right" className="w-16">
            {remaining}% left
          </Text>
        )}
      </div>
    </div>
  );
}

/** Usage / rate-limit section shared by Codex and Copilot. */
export function ProviderUsageSection({
  isLoading,
  rows,
  readout,
}: {
  isLoading: boolean;
  rows: ProviderUsageRow[];
  readout: UsageReadout;
}) {
  return (
    <SettingsSection title="Usage">
      {isLoading ? (
        <div className="divide-y divide-primary-200/50 dark:divide-primary-800/20">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center justify-between py-4">
              <div className="flex flex-col gap-1.5">
                <div className="h-3 w-36 rounded bg-primary-200/50 dark:bg-primary-700/30 animate-pulse" />
                <div className="h-3 w-24 rounded bg-primary-200/30 dark:bg-primary-700/20 animate-pulse" />
              </div>
              <div className="flex items-center gap-3">
                <div className="animate-pulse">
                  <UsageTicks usedPercent={100} label="Loading usage" />
                </div>
                <div className="h-4 w-16 rounded bg-primary-200/50 dark:bg-primary-700/30 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length > 0 ? (
        <div className="divide-y divide-primary-200/50 dark:divide-primary-800/20">
          {rows.map((row, i) => (
            <UsageRateLimitRow key={`${row.label}-${i}`} row={row} readout={readout} />
          ))}
        </div>
      ) : (
        <div className="px-4 py-3">
          <Text as="span" tone="subtle">
            No usage data available
          </Text>
        </div>
      )}
    </SettingsSection>
  );
}

/** Display label for the currently selected structured-output schema. */
export function selectedSchemaLabel(config: {
  structuredOutputs?: Record<string, { name?: string }>;
  structuredOutputsSelectedId?: string | null;
}): string {
  const id = config.structuredOutputsSelectedId ?? null;
  if (!id) return "Off";
  return config.structuredOutputs?.[id]?.name ?? "Off";
}

export function ProviderSettingsLayout({
  title,
  provider,
  isLoading,
  error,
  children,
  className = "",
}: {
  title: string;
  provider: ProviderData;
  isLoading: boolean;
  error: unknown;
  children: ReactNode;
  className?: string;
}) {
  const missingProvider = !isLoading && !error && !provider;

  return (
    <SettingsPageShell
      title={title}
      isLoading={isLoading}
      error={error || missingProvider || undefined}
      errorMessage={`${title} provider not found. Make sure it is configured in the database.`}
      className={className}
    >
      {children}
    </SettingsPageShell>
  );
}
