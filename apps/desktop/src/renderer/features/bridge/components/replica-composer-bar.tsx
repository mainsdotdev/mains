import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BridgeBackendInfo, BridgeRunState, BridgeStatus } from "@mains/contracts/bridge";
import { AsciiSpinner, Button, Text } from "@/components/ui";
import { Lock } from "@/components/ui/icons";
import type { Run } from "@/lib/redux/api";
import type { ProviderVariant } from "@/lib/provider-variants";
import { bridgePresence } from "../lib/backends";

const isActiveStatus = (run: Pick<Run, "status">) => run.status === "running" || run.status === "queued";
/** A replica's status is only live while its source is reachable; an offline source's "running" is stale. */
export const isReplicaLive = (run: Pick<Run, "status">, owner: BridgeBackendInfo) => isActiveStatus(run) && owner.online === true;

function useElapsed(since: number | null | undefined, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active || since == null) return null;
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Occupies the composer's slot and shape, without mounting a composer or provider controller. */
export function ReplicaComposerBar({ run, owner, status, hydration, variant }: {
  run: Pick<Run, "status" | "startedAt"> | undefined; owner: BridgeBackendInfo; status: BridgeStatus | undefined;
  hydration: BridgeRunState | undefined; variant: ProviderVariant;
}) {
  const navigate = useNavigate();
  const live = !!run && isReplicaLive(run, owner);
  const elapsed = useElapsed(run?.startedAt, live);
  const hubOffline = status?.enabled === true && status.state !== "connected" && status.state !== "read-only";
  const notice = hubOffline ? "Showing saved data"
    : hydration && !hydration.ready ? hydration.error ? "Waiting to download this conversation" : "Downloading conversation…" : null;
  return <div data-testid="replica-composer"
    className="relative mx-auto mb-4 flex w-full min-w-0 max-w-210 items-center gap-3 rounded-[28px] glass-surface px-4 py-3">
    <Lock aria-hidden="true" className="size-4 shrink-0 text-primary-500" />
    <div className="flex min-w-0 flex-1 flex-col">
      <Text size="s" weight="medium" className="truncate">Read-only · runs on {owner.label}</Text>
      <div className="flex min-w-0 items-center gap-1.5">
        {live ? <>
          <span className="flex size-3.5 shrink-0 items-center justify-center"><AsciiSpinner variant={variant} /></span>
          <Text size="xs" tone="muted" className="truncate">Running{elapsed ? ` · ${elapsed}` : ""}</Text>
        </> : <>
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${owner.online === true ? "bg-success" : "bg-primary-400"}`} />
          <Text size="xs" tone="muted" className="truncate">{bridgePresence(owner)}</Text>
        </>}
        {notice && <Text size="xs" tone="muted" className="truncate">· {notice}</Text>}
      </div>
    </div>
    <Button variant="primary" onClick={() => navigate("/settings?section=backends")} title={`Connect to ${owner.label} in Settings › Mains Connect to control this conversation`}>
      Continue with remote control
    </Button>
  </div>;
}
