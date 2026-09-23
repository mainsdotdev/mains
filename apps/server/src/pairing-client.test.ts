import { describe, expect, it, vi } from "vitest";
import {
  listPairedDevices,
  requestPairingCode,
  requestWebLogin,
  revokePairedDevice,
} from "./pairing-client";

describe("requestPairingCode", () => {
  it("asks the running server to mint the one-time code", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          code: "one-time",
          link: "mains://pair#code=one-time&endpoint=http%3A%2F%2Flan",
          expiresAt: "2026-09-21T10:05:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      requestPairingCode({
        controlUrl: "http://127.0.0.1:8787",
        token: "root-token",
        endpoints: ["http://192.168.1.5:8787"],
        fetchImpl,
      }),
    ).resolves.toMatchObject({ code: "one-time" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://127.0.0.1:8787/__mains/admin/pairing-code",
    );
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ endpoints: ["http://192.168.1.5:8787"] }),
    });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer root-token",
    );
  });

  it("explains an authentication mismatch", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    await expect(
      requestPairingCode({
        controlUrl: "http://127.0.0.1:8787",
        token: "wrong",
        endpoints: ["http://192.168.1.5:8787"],
        fetchImpl,
      }),
    ).rejects.toThrow("pass --token");
  });

  it("lists and revokes paired devices", async () => {
    const device = {
      id: "device-1",
      name: "Phone",
      platform: "ios",
      appVersion: null,
      createdAt: "2026-09-21T10:00:00.000Z",
      lastSeenAt: null,
    };
    let call = 0;
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        call += 1;
        return call === 1
          ? new Response(JSON.stringify([device]), { status: 200 })
          : new Response(JSON.stringify({ revoked: true }), { status: 200 });
      },
    );
    const options = {
      controlUrl: "http://127.0.0.1:8787",
      token: "root-token",
      fetchImpl,
    };

    await expect(listPairedDevices(options)).resolves.toEqual([device]);
    await expect(revokePairedDevice(options, "device-1")).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[1]?.[0]).toEqual(
      new URL("http://127.0.0.1:8787/__mains/admin/devices/device-1"),
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });
});

describe("requestWebLogin", () => {
  it("asks the running server for an origin-bound one-time login", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            link: "https://mains.example/#login=one-time",
            expiresAt: "2026-09-21T10:05:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    await expect(
      requestWebLogin({
        controlUrl: "http://127.0.0.1:8787",
        token: "root-token",
        baseUrl: "https://mains.example",
        fetchImpl,
      }),
    ).resolves.toEqual({
      link: "https://mains.example/#login=one-time",
      expiresAt: "2026-09-21T10:05:00.000Z",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://127.0.0.1:8787/__mains/admin/web-login",
    );
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ baseUrl: "https://mains.example" }),
    });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer root-token",
    );
  });

  it("rejects malformed responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ link: "missing-expiry" }), { status: 200 }),
    );

    await expect(
      requestWebLogin({
        controlUrl: "http://127.0.0.1:8787",
        token: "root-token",
        baseUrl: "http://127.0.0.1:8787",
        fetchImpl,
      }),
    ).rejects.toThrow("invalid browser login");
  });
});
