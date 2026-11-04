import { getRandomValues } from "expo-crypto";
import { createRelaySocket } from "@mains/relay/socket";
import type { PairedBackend } from "./paired-backend-store";
import type { WebSocketLike } from "./ws-transport";

/** A selector inside the existing endpoint supervisor, never an HTTP endpoint. */
function relayEndpoint(backend: PairedBackend): string | undefined {
  return backend.relay ? `${backend.relay.url.replace(/^ws/, "http")}/__mains/relay` : undefined;
}

export function pairedBackendEndpoints(backend: PairedBackend): string[] {
  const relay = relayEndpoint(backend);
  // Try the globally reachable endpoint immediately rather than spending the
  // recovery window probing remembered LAN addresses from another network.
  return relay ? [relay, ...backend.endpoints] : backend.endpoints;
}

export function pairedSocketFactory(backend: PairedBackend, endpoint: string): ((url: string, protocols?: string[]) => WebSocketLike) | undefined {
  if (!backend.relay || endpoint !== relayEndpoint(backend)) return undefined;
  const access = backend.relay;
  return () => createRelaySocket(access, backend, (url, protocols) => new WebSocket(url, protocols), (length) => getRandomValues(new Uint8Array(length)));
}
