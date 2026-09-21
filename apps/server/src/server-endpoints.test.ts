import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import {
  discoverReachableEndpoints,
  normalizeEndpoint,
  resolveControlUrl,
} from "./server-endpoints";

function address(value: string, internal = false): NetworkInterfaceInfo {
  return {
    address: value,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${value}/24`,
  };
}

describe("discoverReachableEndpoints", () => {
  it("advertises Tailscale HTTPS before private wildcard interfaces", () => {
    expect(
      discoverReachableEndpoints({
        host: "0.0.0.0",
        port: 8787,
        tailscaleUrl: "https://mac.example.ts.net/",
        interfaces: {
          lo0: [address("127.0.0.1", true)],
          en0: [address("192.168.1.25")],
          utun: [address("100.90.80.70")],
          public: [address("203.0.113.5")],
        },
      }),
    ).toEqual([
      "https://mac.example.ts.net",
      "http://192.168.1.25:8787",
      "http://100.90.80.70:8787",
    ]);
  });

  it("does not advertise loopback and accepts explicit public URLs", () => {
    expect(
      discoverReachableEndpoints({
        host: "127.0.0.1",
        port: 8787,
        publicUrls: ["https://mains.example.com/"],
      }),
    ).toEqual(["https://mains.example.com"]);
  });

  it("advertises an explicitly bound non-loopback host", () => {
    expect(
      discoverReachableEndpoints({
        host: "mains.internal",
        port: 9000,
      }),
    ).toEqual(["http://mains.internal:9000"]);
  });
});

describe("endpoint validation", () => {
  it("rejects credentials and non-HTTP protocols", () => {
    expect(() => normalizeEndpoint("file:///tmp/mains")).toThrow("HTTP or HTTPS");
    expect(() => normalizeEndpoint("https://user:pass@example.com")).toThrow(
      "base URL",
    );
  });

  it("uses loopback to control wildcard listeners", () => {
    expect(resolveControlUrl("0.0.0.0", 8787)).toBe("http://127.0.0.1:8787");
    expect(resolveControlUrl("::", 8787)).toBe("http://[::1]:8787");
  });
});
