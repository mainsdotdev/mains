import type { BridgeBackendInfo, BridgeStatus } from "@mains/contracts/bridge";

export function bridgeBackend(status: BridgeStatus | undefined, backendId: string | undefined): BridgeBackendInfo {
  return status?.backends.find((backend) => backend.backendId === backendId) ?? {
    backendId: backendId ?? "unknown", label: backendId ? `Device ${backendId.slice(0, 8)}` : "Another device", online: null, lastSeen: null, platform: null,
  };
}
export function bridgePresence(backend: BridgeBackendInfo): string {
  if (backend.online === true) return "Online";
  if (!backend.lastSeen) return backend.online === false ? "Offline" : "Status unavailable";
  const date = new Date(backend.lastSeen);
  if (!Number.isFinite(date.getTime())) return "Status unavailable";
  const when = date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return backend.online === false ? `Offline since ${when}` : `Last seen ${when}`;
}
export function groupReplicaItems<T extends { isReplica?: boolean; ownerBackendId?: string }>(items: T[], status?: BridgeStatus) {
  const groups = new Map<string, T[]>();
  for (const item of items) if (item.isReplica) {
    const key = item.ownerBackendId ?? "unknown";
    const rows = groups.get(key); if (rows) rows.push(item); else groups.set(key, [item]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([id, rows]) => ({ backend: bridgeBackend(status, id), rows }));
}
