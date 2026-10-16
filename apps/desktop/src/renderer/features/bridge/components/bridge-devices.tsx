import { Button, Text, toast } from "@/components/ui";
import { Lock, Relay } from "@/components/ui/icons";
import { useSyncBridgeNowMutation } from "@/lib/redux/api/bridgeApi";
import { getTransport } from "@/lib/transport";
import { useBridgeStatus } from "../hooks/use-bridge";
import { bridgePresence } from "../lib/backends";

const labels = { disabled: "Off", connecting: "Connecting", syncing: "Syncing", connected: "Connected", "read-only": "Read only", offline: "Offline", error: "Sync paused" };
export function BridgeDevices() {
  const { data: status } = useBridgeStatus();
  const [sync, { isLoading }] = useSyncBridgeNowMutation();
  if (!status) return null;
  const deviceLabel = getTransport().kind === "ipc" ? "this device" : status.label.trim() || "the connected computer";
  const peers = status.backends.filter((backend) => backend.backendId !== status.backendId);
  return <section className="mt-8 space-y-3" aria-label="Bridge device sync">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2"><Relay className="size-4" /><Text as="h2" size="sm" weight="medium">Device sync</Text></div>
      <Text size="xs" tone="muted">{labels[status.state]}</Text>
    </div>
    <Text size="xs" tone="muted">Conversations from your other devices are saved on {deviceLabel}. Connect to a device to control its chats.</Text>
    {!status.enabled ? <Text size="xs" tone="muted">Bridge is not set up on {deviceLabel}.</Text> : <>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-primary-200/60 px-3 py-2 dark:border-primary-800/60">
        <div className="min-w-0"><Text size="s" className="truncate">{status.label}</Text><Text size="xs" tone="muted">{status.pendingRecords ? `${status.pendingRecords} changes waiting to sync` : "End-to-end encrypted"}</Text></div>
        <Button variant="secondary" disabled={isLoading} onClick={() => { void sync().unwrap().catch(() => toast.error("Could not sync. Your saved data is still available.")); }}>Sync now</Button>
      </div>
      {status.error && <Text size="xs" tone="muted">{status.error}</Text>}
      {peers.map((backend) => <div key={backend.backendId} className="flex items-center gap-3 px-3 py-1">
        <Lock className="size-3.5 shrink-0 text-primary-500" /><div className="min-w-0"><Text size="s" className="truncate">{backend.label}</Text><Text size="xs" tone="muted">{bridgePresence(backend)}</Text></div>
      </div>)}
    </>}
  </section>;
}
