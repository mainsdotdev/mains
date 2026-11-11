import { describe, expect, it } from "vitest";
import { createWebSessionManager } from "./web-session";

function codeFrom(link: string): string {
  return new URLSearchParams(new URL(link).hash.slice(1)).get("login") ?? "";
}

describe("web session manager", () => {
  it("revokes a session lease and its image credential together at the capacity boundary", () => {
    const manager = createWebSessionManager();
    const origin = "https://mains.example";
    const login = () => manager.exchange(codeFrom(manager.createLogin(origin).link), origin)!;
    const first = login();
    const lease = manager.authorizeSession(first.sessionToken, origin)!;
    for (let index = 1; index < 128; index++) login();
    expect(lease.current()).toBe(true);
    const latest = login();
    expect(lease.current()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    expect(manager.verifySession(first.sessionToken, origin)).toBeNull();
    expect(manager.verifyImageSession(first.imageToken, origin)).toBe(false);
    expect(manager.verifySession(latest.sessionToken, origin)).not.toBeNull();
    expect(manager.verifyImageSession(latest.imageToken, origin)).toBe(true);
  });

  it("clears pending links, active leases and image access while permitting a fresh login", () => {
    const manager = createWebSessionManager();
    const origin = "https://mains.example";
    const pending = codeFrom(manager.createLogin(origin).link);
    const active = manager.exchange(codeFrom(manager.createLogin(origin).link), origin)!;
    const lease = manager.authorizeSession(active.sessionToken, origin)!;
    manager.clear(); manager.clear();
    expect(manager.exchange(pending, origin)).toBeNull();
    expect(lease.signal.aborted).toBe(true);
    expect(lease.current()).toBe(false);
    expect(manager.verifySession(active.sessionToken, origin)).toBeNull();
    expect(manager.verifyImageSession(active.imageToken, origin)).toBe(false);
    expect(manager.exchange(codeFrom(manager.createLogin(origin).link), origin)).not.toBeNull();
  });

  it("checks the exact session deadline for established leases without relying on a timer", () => {
    let now = 1_000;
    const manager = createWebSessionManager({ now: () => now, sessionTtlMs: 100 });
    const origin = "https://mains.example";
    const active = manager.exchange(codeFrom(manager.createLogin(origin).link), origin)!;
    const lease = manager.authorizeSession(active.sessionToken, origin)!;
    now += 99;
    expect(lease.current()).toBe(true);
    now++;
    expect(lease.current()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    expect(manager.verifyImageSession(active.imageToken, origin)).toBe(false);
  });

  it("bounds pending links and keeps the image and socket credentials in separate scopes", () => {
    const manager = createWebSessionManager();
    const origin = "https://mains.example";
    const codes = Array.from({ length: 33 }, () => codeFrom(manager.createLogin(origin).link));
    expect(manager.exchange(codes[0], origin)).toBeNull();
    const active = manager.exchange(codes[1], origin)!;
    expect(manager.verifySession(active.imageToken, origin)).toBeNull();
    expect(manager.verifyImageSession(active.sessionToken, origin)).toBe(false);
    expect(manager.exchange(codes[32], origin)).not.toBeNull();
  });
  it("exchanges an origin-bound login code exactly once", () => {
    let now = 1_000;
    const manager = createWebSessionManager({ now: () => now });
    const login = manager.createLogin("https://mains.example/");
    const code = codeFrom(login.link);

    expect(login.link).toMatch(/^https:\/\/mains\.example\/#login=/);
    expect(login.link).not.toContain("owner");
    expect(manager.exchange(code, "https://other.example")).toBeNull();

    const credentials = manager.exchange(code, "https://mains.example");
    expect(credentials).toMatchObject({ secure: true });
    expect(credentials?.sessionToken).not.toBe(credentials?.imageToken);
    expect(manager.exchange(code, "https://mains.example")).toBeNull();

    expect(
      manager.verifySession(
        credentials?.sessionToken ?? null,
        "https://mains.example",
      ),
    ).toEqual({ expiresAt: credentials?.expiresAt });
    expect(
      manager.verifySession(
        credentials?.sessionToken ?? null,
        "https://other.example",
      ),
    ).toBeNull();
    expect(
      manager.verifyImageSession(
        credentials?.imageToken ?? null,
        "https://mains.example",
      ),
    ).toBe(true);
    expect(
      manager.verifyImageSession(
        credentials?.imageToken ?? null,
        "https://other.example",
      ),
    ).toBe(false);

    now += 8 * 60 * 60 * 1000;
    expect(
      manager.verifySession(
        credentials?.sessionToken ?? null,
        "https://mains.example",
      ),
    ).toBeNull();
    expect(
      manager.verifyImageSession(
        credentials?.imageToken ?? null,
        "https://mains.example",
      ),
    ).toBe(false);
  });

  it("expires unused login codes and marks HTTP sessions non-secure", () => {
    let now = 5_000;
    const manager = createWebSessionManager({ now: () => now });
    const login = manager.createLogin("http://127.0.0.1:8787");
    const code = codeFrom(login.link);
    now += 5 * 60 * 1000;

    expect(manager.exchange(code, "http://127.0.0.1:8787")).toBeNull();

    const fresh = manager.createLogin("http://127.0.0.1:8787");
    expect(
      manager.exchange(codeFrom(fresh.link), "http://127.0.0.1:8787")?.secure,
    ).toBe(false);
  });

  it("rejects URLs that are not a bare HTTP(S) origin", () => {
    const manager = createWebSessionManager();
    expect(() => manager.createLogin("file:///tmp/mains")).toThrow("HTTP or HTTPS");
    expect(() => manager.createLogin("https://user@example.com")).toThrow(
      "without a path or credentials",
    );
    expect(() => manager.createLogin("https://example.com/app")).toThrow(
      "without a path or credentials",
    );
  });
});
