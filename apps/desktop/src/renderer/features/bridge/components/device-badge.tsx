import type { BridgeBackendInfo } from "@mains/contracts/bridge";
import { Tooltip } from "@/components/ui";
import { Bridge as DeviceIcon } from "@/components/ui/icons";
import { bridgePresence } from "../lib/backends";

export function DeviceBadge({ backend, compact = false }: { backend: BridgeBackendInfo; compact?: boolean }) {
  return <Tooltip content={`${backend.label} · ${bridgePresence(backend)}`}>
    <span className="inline-flex max-w-40 min-w-0 shrink-0 items-center gap-1 rounded-md bg-primary-100/70 px-1.5 py-0.5 text-[10px] text-primary-600 dark:bg-primary-800/50 dark:text-primary-400">
      <DeviceIcon aria-hidden="true" className={`size-3 shrink-0 ${backend.online === true ? "text-success" : ""}`} />
      {!compact && <span className="truncate">{backend.label}</span>}
    </span>
  </Tooltip>;
}
