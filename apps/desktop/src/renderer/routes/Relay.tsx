import { PageShell } from "@/components/layout/page-shell";
import BackendsSettings from "@/features/relay/components/backends";
import { BridgeDevices } from "@/features/bridge/components/bridge-devices";


export default function RelayPage() {
  return (
    <PageShell>
      <BackendsSettings />
      <BridgeDevices />
    </PageShell>
  );
}
