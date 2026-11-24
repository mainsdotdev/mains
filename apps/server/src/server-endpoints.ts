import { privateLanAddresses } from "@mains/backend/ipc-kit/lan-listeners";
import { isConnectLoopback, isSecureConnectEndpoint } from "@mains/contracts/connect-endpoint";
import { type NetworkInterfaceInfo } from "node:os";

type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface ReachableEndpointOptions {
  host: string;
  port: number;
  tailscaleUrl?: string | null;
  publicUrls?: readonly string[];
  interfaces?: InterfaceMap;
  lanAddresses?: readonly string[];
}

function hostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function httpEndpoint(host: string, port: number): string {
  return `http://${hostForUrl(host)}:${port}`;
}

export function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid endpoint URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Endpoint must use HTTP or HTTPS: ${value}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Endpoint must be a base URL: ${value}`);
  }
  if (!isSecureConnectEndpoint(value)) throw new Error("Remote endpoints require HTTPS.");
  return url.toString().replace(/\/$/, "");
}

function appendUnique(target: string[], value: string): void {
  const normalized = normalizeEndpoint(value);
  if (!target.includes(normalized)) target.push(normalized);
}

/**
 * Endpoints safe to put in a phone pairing link. Wildcard binds advertise only
 * private IPv4 interfaces; a public address must be opted into explicitly with
 * `--public-url` so an accidental VPS bind never prints an insecure public URL.
 */
export function discoverReachableEndpoints(
  options: ReachableEndpointOptions,
): string[] {
  const endpoints: string[] = [];
  for (const url of options.publicUrls ?? []) appendUnique(endpoints, url);
  if (options.tailscaleUrl) appendUnique(endpoints, options.tailscaleUrl);

  const host = options.host.trim();
  const wildcard = host === "0.0.0.0" || host === "::" || host === "[::]";
  const loopback = isConnectLoopback(host);

  if (wildcard) {
    const addresses = options.lanAddresses ?? privateLanAddresses(options.interfaces);
    for (const address of addresses) {
      appendUnique(endpoints, `https://${hostForUrl(address)}:${options.port}`);
    }
  } else if (!loopback) {
    appendUnique(endpoints, `https://${hostForUrl(host)}:${options.port}`);
  }

  return endpoints;
}

/** URL the same-machine CLI uses for authenticated server administration. */
export function resolveControlUrl(host: string, port: number): string {
  return httpEndpoint(isConnectLoopback(host) ? host : "127.0.0.1", port);
}
