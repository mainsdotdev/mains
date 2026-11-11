import { useCallback, useLayoutEffect, useReducer, useState } from "react";
import { CHANNELS } from "@mains/contracts/channels";
import type { ProviderConnectorsUpdatedEvent } from "@mains/contracts/provider-connectors";
import { toast } from "@/components/ui";
import { useStartProviderConnectorOAuthMutation } from "@/lib/redux/api";
import { getTransport, onTransportChange } from "@/lib/transport/registry";
import { createConnectorOAuthLifecycle } from "../lib/connector-oauth-lifecycle";

type Owner = { providerId: string; lifecycle: ReturnType<typeof createConnectorOAuthLifecycle> };

/** React only binds a provider scope, its events and pending-state updates. */
export function useConnectorOAuth(providerId: string) {
  const [startConnectorOAuth] = useStartProviderConnectorOAuthMutation();
  const [owner, setOwner] = useState<Owner | null>(null);
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);

  useLayoutEffect(() => {
    let lifecycle: Owner["lifecycle"] | undefined;
    let off: (() => void) | undefined;
    const bind = () => {
      lifecycle?.dispose(); off?.();
      const transport = getTransport();
      const next = createConnectorOAuthLifecycle({
        providerId,
        isCurrent: () => getTransport() === transport,
        start: (serverName) => startConnectorOAuth({ providerId, serverName }).unwrap(),
        openExternal: (url) => window.api.shell.openExternal(url),
        changed: refresh,
        failed: (message) => toast.error(message),
      });
      lifecycle = next;
      off = transport.subscribe(CHANNELS.providers.connectorsUpdated, (payload) => next.receive(payload as ProviderConnectorsUpdatedEvent));
      setOwner({ providerId, lifecycle });
    };
    bind();
    const offTransport = onTransportChange(bind);
    return () => { offTransport(); lifecycle?.dispose(); off?.(); };
  }, [providerId, startConnectorOAuth]);

  const lifecycle = owner?.providerId === providerId ? owner.lifecycle : undefined;
  const startLogin = useCallback((serverName: string) => lifecycle?.startLogin(serverName) ?? Promise.resolve(), [lifecycle]);
  return { startLogin, isPending: (serverName: string) => lifecycle?.isPending(serverName) ?? false };
}
