import type { ReactNode } from "react";
import type { ProviderId } from "@mains/contracts/provider-ids";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";
import {
  Text,
  Tooltip,
  UsageTicks,
  type TooltipPosition,
} from "@/components/ui";
import { useGetProviderRateLimitsQuery } from "@/lib/redux/api/providersApi";
import { buildClaudeUsageRows } from "../lib/claude-usage";
import { buildCodexUsageRows } from "../lib/codex-usage";
import {
  formatResetDate,
  type ProviderUsageRow,
} from "./provider-settings-shared";

function ProviderUsageContent({
  providerId,
  name,
}: {
  providerId: ProviderId;
  name: string;
}) {
  // Mounted by Tooltip only after its hover delay. The shared query cache also
  // avoids refetching when moving between spaces backed by the same provider.
  const { data, isLoading, isError } = useGetProviderRateLimitsQuery(
    providerId,
    {
      refetchOnMountOrArgChange: 30,
      pollingInterval: 60000,
    },
  );
  const rows: ProviderUsageRow[] =
    providerId === PROVIDER_IDS.codex
      ? buildCodexUsageRows(data)
      : providerId === PROVIDER_IDS.claude
        ? buildClaudeUsageRows(data)
        : [data?.primary, data?.secondary].flatMap((window) =>
            window ? [{ ...window, label: window.label ?? "Usage limit" }] : [],
          );
  const validRows = rows.filter((row) => Number.isFinite(row.usedPercent));

  return (
    <div className="w-64 max-w-[calc(100vw-3rem)] space-y-3 whitespace-normal p-2">
      <div className="flex items-center justify-between gap-3">
        <Text as="span" size="xs" weight="medium">
          {name}
        </Text>
        <Text as="span" size="xxs" tone="subtle">
          Usage limits
        </Text>
      </div>
      {validRows.length > 0 ? (
        validRows.map((row, index) => {
          const remaining = Math.round(
            100 - Math.min(100, Math.max(0, row.usedPercent)),
          );
          const counts =
            Number.isFinite(row.used) && Number.isFinite(row.total);
          return (
            <div
              key={`${row.group ?? ""}:${row.label}:${index}`}
              className="space-y-1.5"
            >
              {row.group && row.group !== validRows[index - 1]?.group && (
                <Text as="div" size="xxs" tone="subtle">
                  {row.group}
                </Text>
              )}
              <div className="flex items-center justify-between gap-3">
                <Text as="span" size="xs">
                  {row.label}
                </Text>
                <Text
                  as="span"
                  size="xs"
                  weight="medium"
                  className="shrink-0 tabular-nums"
                >
                  {remaining}% left
                </Text>
              </div>
              <UsageTicks
                usedPercent={row.usedPercent}
                label={row.label}
                className="justify-between gap-0"
              />
              <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                {row.resetsAt && Number.isFinite(row.resetsAt) ? (
                  <Text as="span" size="xxs" tone="subtle">
                    {formatResetDate(row.resetsAt)}
                  </Text>
                ) : null}
                {counts && (
                  <Text
                    as="span"
                    size="xxs"
                    tone="subtle"
                    className="tabular-nums"
                  >
                    {Math.max(0, row.total! - row.used!).toLocaleString()} /{" "}
                    {row.total!.toLocaleString()} left
                  </Text>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <Text as="div" size="xs" tone="subtle" role="status">
          {isLoading
            ? "Loading usage limits…"
            : isError
              ? "Couldn’t load usage limits"
              : "No usage data available"}
        </Text>
      )}
    </div>
  );
}

export function ProviderUsageTooltip({
  id,
  providerId,
  name,
  position,
  children,
}: {
  id: string;
  providerId: ProviderId;
  name: string;
  position: TooltipPosition;
  children: ReactNode;
}) {
  return (
    <Tooltip
      id={id}
      content={<ProviderUsageContent providerId={providerId} name={name} />}
      position={position}
      delay={250}
      hideOnClick
      constrainToViewport
      interactive
      className="rounded-2xl max-h-[calc(100vh-1rem)] overflow-y-auto"
    >
      {children}
    </Tooltip>
  );
}
