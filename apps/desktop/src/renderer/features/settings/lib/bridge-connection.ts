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
  switch (status.state) {
    case "connected": return pending ?? lastSync ?? "No pending changes";
    case "syncing": return pending ? `Syncing · ${pending}` : "Syncing…";
    case "offline": return `Offline · ${pending ?? lastSync ?? "Reconnecting automatically"}`;
    case "error": return `Sync paused · ${pending ?? lastSync ?? "Your local data is kept"}`;
    case "read-only": return `Read only · ${pending ?? "New uploads are paused"}`;
    case "disabled": return "Sync is not enabled";
    default: return "Connecting to Bridge…";
  }
}
