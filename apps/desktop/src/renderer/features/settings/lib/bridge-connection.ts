import type { BridgeStatus } from "@mains/contracts/bridge";

export function bridgeConnectionDescription(status: BridgeStatus | undefined): string {
  if (!status) return "Checking connection…";
  const pending = status.pendingRecords > 0
    ? `${status.pendingRecords} change${status.pendingRecords === 1 ? "" : "s"} waiting to sync`
    : null;
  const date = status.lastSyncedAt ? new Date(status.lastSyncedAt) : null;
  const lastSync = date && Number.isFinite(date.getTime())
    ? `Last synced ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
    : null;
  const rejected = status.rejectedRecords ?? 0;
  const skipped = rejected > 0
    ? ` · ${rejected} change${rejected === 1 ? "" : "s"} from another device couldn't be applied and ${rejected === 1 ? "was" : "were"} skipped`
    : "";
  const retryDate = status.writeRetryAt ? new Date(status.writeRetryAt) : null;
  const pacing = retryDate && Number.isFinite(retryDate.getTime())
    ? ` · Upload limit reached; resuming at ${retryDate.toLocaleTimeString()}` : "";
  switch (status.state) {
    case "connected": return (pending ?? lastSync ?? "No pending changes") + skipped;
    case "syncing": return (pending ? `Syncing · ${pending}` : "Syncing…") + pacing + skipped;
    case "offline": return `Offline · ${pending ?? lastSync ?? "Reconnecting automatically"}`;
    case "error": return `Sync paused · ${pending ?? lastSync ?? "Your local data is kept"}`;
    case "read-only": return `Read only · ${pending ?? "New uploads are paused"}` + skipped;
    case "disabled": return "Sync is not enabled";
    default: return "Connecting to Bridge…";
  }
}
