import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useCapabilities } from "@/lib/platform";
import { getTransport, onTransportChange } from "@/lib/transport";
import { useGetMcpAppEntrypointsQuery } from "@/lib/redux/api/mcpAppsApi";
import { useSpaceProviderVariant } from "./use-space-provider-variant";

export function useMcpAppExtensionsAvailable(): boolean {
  const { mcpAppExtensions } = useCapabilities();
  const provider = useSpaceProviderVariant();
  const isLocal = useSyncExternalStore(onTransportChange, () => getTransport().kind === "ipc");
  return mcpAppExtensions && isLocal && provider.supportsMcpAppExtensions;
}

export function useMcpAppExtensions() {
  const available = useMcpAppExtensionsAvailable();
  const provider = useSpaceProviderVariant();
  const query = useGetMcpAppEntrypointsQuery(provider.providerId, {
    skip: !available,
    refetchOnMountOrArgChange: 30,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!available) return;
    const refresh = () => { void refetch(); };
    // Changes made in Codex itself become visible when returning to Mains.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [available, refetch]);
  const entries = useMemo(() => available
    ? (query.currentData ?? []).filter((entry) => entry.entrypoints.includes("global"))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    : [], [available, query.currentData]);
  return { ...query, available, entries };
}
