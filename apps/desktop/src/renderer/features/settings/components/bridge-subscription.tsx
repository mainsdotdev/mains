import { useState } from "react";
import type { BridgeBillingInterval, BridgeSubscriptionStatus } from "@mains/contracts/bridge-subscription";
import { Button, Muted, SegmentedTabs, StatusBadge, Text, type StatusTone } from "@/components/ui";
import { Check, Clock, Minus, Warning } from "@/components/ui/icons";
import { SettingsSection } from "./settings-layout";

const subscriptionStatus = {
  none: { label: "Subscription required", tone: "warning", icon: Warning },
  scheduled: { label: "Scheduled", tone: "info", icon: Clock },
  active: { label: "Active", tone: "success", icon: Check },
  expired: { label: "Expired", tone: "warning", icon: Warning },
  revoked: { label: "Inactive", tone: "neutral", icon: Minus },
  unavailable: { label: "Plan unavailable", tone: "warning", icon: Warning },
} satisfies Record<Exclude<BridgeSubscriptionStatus["subscription"]["status"], "development">, { label: string; tone: StatusTone; icon: typeof Check }>;

export function BridgeSubscriptionSection({ subscription, plans, busy, onRefresh, deviceLabel = "this device" }: BridgeSubscriptionStatus & { busy: boolean; onRefresh: () => void; deviceLabel?: string }) {
  const [interval, setInterval] = useState<BridgeBillingInterval>(subscription.billingInterval ?? "monthly");
  if (subscription.status === "development") return null;
  const status = subscriptionStatus[subscription.status];
  const plan = plans.find((entry) => entry.id === subscription.planId) ?? plans[0];
  const expires = subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
  const starts = subscription.startsAt ? new Date(subscription.startsAt).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
  const beta = subscription.source === "beta";
  const betaExpires = subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <SettingsSection title={beta ? "Beta access" : "Subscription"}>
      <div className="space-y-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <Text weight="medium">{plan?.name ?? "Bridge"}</Text>
            {plan && <Muted size="xs">{(plan.storageLimitBytes / 1024 ** 3).toLocaleString()} GiB storage · {(plan.fileLimitBytes / 1024 ** 2).toLocaleString()} MiB per file</Muted>}
          </div>
          <StatusBadge tone={status.tone} icon={status.icon}>{status.label}</StatusBadge>
        </div>
        {beta ? (
          <Muted>{subscription.status === "active" ? `Beta access ends ${betaExpires}.` : subscription.status === "expired" ? `Beta access ended ${betaExpires}.` : "Beta access is inactive."}</Muted>
        ) : subscription.status === "active" || subscription.status === "scheduled" ? (
          <Muted>{subscription.billingInterval === "yearly" ? "Yearly" : "Monthly"} subscription · {subscription.status === "scheduled" ? `Starts ${starts}` : `Active until ${expires}`}</Muted>
        ) : (
          <div className="max-w-xl space-y-3">
            {subscription.status === "expired" && expires && <Muted size="xs">{subscription.billingInterval === "yearly" ? "Yearly" : "Monthly"} subscription ended {expires}.</Muted>}
            <SegmentedTabs<BridgeBillingInterval> aria-label="Billing cycle" semantics="radiogroup" value={interval} onChange={setInterval}
              options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }]} />
            <Muted size="xs">{interval === "yearly" ? "One year" : "One month"} of Bridge with the same storage and sync features. Purchases are not available yet.</Muted>
          </div>
        )}
        {!subscription.canUpload && <Text size="xs" tone="muted" className="max-w-xl">New uploads are paused. You can still read, download and delete synced data. Changes on {deviceLabel} stay queued until {beta ? "Bridge access" : "your subscription"} is active.</Text>}
        <Button variant="secondary" disabled={busy} onClick={onRefresh}>{beta ? "Refresh access status" : "Refresh subscription status"}</Button>
      </div>
    </SettingsSection>
  );
}
