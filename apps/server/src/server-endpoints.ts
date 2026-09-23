import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface ReachableEndpointOptions {
  host: string;
  port: number;
  tailscaleUrl?: string | null;
  publicUrls?: readonly string[];
  interfaces?: InterfaceMap;
}

function isIpv4(entry: NetworkInterfaceInfo): boolean {
  return entry.family === "IPv4";
}

function ipv4Octets(address: string): number[] | null {
  const octets = address.split(".").map(Number);
  return octets.length === 4 && octets.every((value) => Number.isInteger(value))
    ? octets
    : null;
}

function isTailnetIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  return Boolean(octets && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
}

function isPrivateIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    isTailnetIpv4(address)
  );
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
  const loopback =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]";

  if (wildcard) {
    const addresses = Object.values(options.interfaces ?? networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter(
        (entry) =>
          isIpv4(entry) && !entry.internal && isPrivateIpv4(entry.address),
      )
      .map((entry) => entry.address)
      .sort((left, right) => {
        const tailnetOrder = Number(isTailnetIpv4(left)) - Number(isTailnetIpv4(right));
        return tailnetOrder || left.localeCompare(right);
      });
    for (const address of addresses) {
      appendUnique(endpoints, httpEndpoint(address, options.port));
    }
  } else if (!loopback) {
    appendUnique(endpoints, httpEndpoint(host, options.port));
  }

  return endpoints;
}

/** URL the same-machine CLI uses for authenticated server administration. */
export function resolveControlUrl(host: string, port: number): string {
  if (host === "0.0.0.0") return httpEndpoint("127.0.0.1", port);
  if (host === "::" || host === "[::]") return httpEndpoint("::1", port);
  return httpEndpoint(host, port);
}
