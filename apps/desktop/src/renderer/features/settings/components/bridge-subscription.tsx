import { useState } from "react";
import type { BridgeBillingInterval, BridgeSubscriptionStatus } from "@mains/contracts/bridge-subscription";
import { Button, Muted, SegmentedTabs, Text } from "@/components/ui";
import { SettingsSection } from "./settings-layout";

const labels = { none: "Subscription required", scheduled: "Scheduled", active: "Active", expired: "Expired", revoked: "Inactive", unavailable: "Plan unavailable", development: "Development" };
export function BridgeSubscriptionSection({ subscription, plans, busy, onRefresh, deviceLabel = "this device" }: BridgeSubscriptionStatus & { busy: boolean; onRefresh: () => void; deviceLabel?: string }) {
  const [interval, setInterval] = useState<BridgeBillingInterval>(subscription.billingInterval ?? "monthly");
  if (subscription.status === "development") return null;
  const plan = plans.find((entry) => entry.id === subscription.planId) ?? plans[0];
  const expires = subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
  const starts = subscription.startsAt ? new Date(subscription.startsAt).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
  return (
    <SettingsSection title="Subscription">
      <div className="space-y-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <Text weight="medium">{plan?.name ?? "Bridge"}</Text>
            {plan && <Muted size="xs">{(plan.storageLimitBytes / 1024 ** 3).toLocaleString()} GiB storage · {(plan.fileLimitBytes / 1024 ** 2).toLocaleString()} MiB per file</Muted>}
          </div>
          <Text size="xs" tone={subscription.canUpload ? "default" : "muted"} className="inline-flex items-center gap-2">
            {subscription.canUpload && <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />}{labels[subscription.status]}
          </Text>
        </div>
        {subscription.status === "active" || subscription.status === "scheduled" ? (
          <Muted>{subscription.billingInterval === "yearly" ? "Yearly" : "Monthly"} subscription · {subscription.status === "scheduled" ? `Starts ${starts}` : `Active until ${expires}`}</Muted>
        ) : (
          <div className="max-w-xl space-y-3">
            {subscription.status === "expired" && expires && <Muted size="xs">{subscription.billingInterval === "yearly" ? "Yearly" : "Monthly"} subscription ended {expires}.</Muted>}
            <SegmentedTabs<BridgeBillingInterval> aria-label="Billing cycle" semantics="radiogroup" value={interval} onChange={setInterval}
              options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }]} />
            <Muted size="xs">{interval === "yearly" ? "One year" : "One month"} of Bridge with the same storage and sync features. Purchases are not available yet.</Muted>
          </div>
        )}
        {!subscription.canUpload && <Text size="xs" tone="muted" className="max-w-xl">New uploads are paused. You can still read, download and delete synced data. Changes on {deviceLabel} stay queued until your subscription is active.</Text>}
        <Button variant="secondary" disabled={busy} onClick={onRefresh}>Refresh subscription status</Button>
      </div>
    </SettingsSection>
  );
}
