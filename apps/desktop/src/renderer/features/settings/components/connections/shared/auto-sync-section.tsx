import { useMemo } from "react";
import { Body, Caption, Toggle, SegmentedTabs, Muted } from "@/components/ui";
import { formatDate } from "@/lib/format-date";
import {
  useGetAutomationsQuery,
  useCreateAutomationMutation,
  useUpdateAutomationMutation,
  useDeleteAutomationMutation,
} from "@/lib/redux/api";

interface AutoSyncSectionProps {
  provider: string;
  providerLabel: string;
}

const INTERVAL_OPTIONS = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "1h" },
  { value: 120, label: "2h" },
  { value: 240, label: "4h" },
  { value: 480, label: "8h" },
  { value: 1440, label: "24h" },
];

export function AutoSyncSection({
  provider,
  providerLabel,
}: AutoSyncSectionProps) {
  const action = `sync:${provider}`;

  const { data: automations = [] } = useGetAutomationsQuery();
  const [createAutomation] = useCreateAutomationMutation();
  const [updateAutomation] = useUpdateAutomationMutation();
  const [deleteAutomation] = useDeleteAutomationMutation();

  const syncAutomation = useMemo(
    () => automations.find((a) => a.action === action),
    [automations, action],
  );

  const isEnabled = syncAutomation?.isActive ?? false;
  const interval = syncAutomation?.intervalMinutes ?? 30;

  const handleToggle = async () => {
    if (isEnabled && syncAutomation) {
      await deleteAutomation(syncAutomation.id);
    } else {
      await createAutomation({
        accountId: "default",
        input: {
          name: `Auto-sync ${providerLabel}`,
          kind: "sync",
          action,
          intervalMinutes: 30,
          isActive: true,
        },
      });
    }
  };

  const handleIntervalChange = async (newInterval: number) => {
    if (syncAutomation) {
      await updateAutomation({
        id: syncAutomation.id,
        input: { intervalMinutes: newInterval },
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between ">
        <div>
          <Body>
            Auto Sync
          </Body>
          <Muted size="xs">
            Automatically sync {providerLabel} data on a schedule
          </Muted>
        </div>
        <Toggle
          enabled={isEnabled ?? false}
          aria-label={`Automatically sync ${providerLabel} data`}
          onChange={() => handleToggle()}
        />
      </div>

      <div className=" space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Caption>Every</Caption>
            <SegmentedTabs
              value={String(interval)}
              onChange={(v) => handleIntervalChange(Number(v))}
              options={INTERVAL_OPTIONS.map((o) => ({
                value: String(o.value),
                label: o.label,
              }))}
              variant="pill"
              semantics="radiogroup"
              aria-label="Sync interval"
              disabled={!isEnabled}
            />
          </div>
          {syncAutomation?.lastRunAt && (
            <Caption>
              Last synced: {syncAutomation.lastRunAt ? formatDate(syncAutomation.lastRunAt) : "Never"}
            </Caption>
          )}
        </div>
      </div>
    </div>
  );
}
