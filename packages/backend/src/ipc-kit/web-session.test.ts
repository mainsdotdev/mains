import { describe, expect, it } from "vitest";
import { createWebSessionManager } from "./web-session";

function codeFrom(link: string): string {
  return new URLSearchParams(new URL(link).hash.slice(1)).get("login") ?? "";
}

describe("web session manager", () => {
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
