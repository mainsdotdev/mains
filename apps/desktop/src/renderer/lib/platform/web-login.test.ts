// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeWebLogin, takeWebLoginCode } from "./web-login";

describe("browser web login", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("settles the login deadline even if a late fetch ignores abort", async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    let failure: unknown;
    const exchange = exchangeWebLogin("code", fetchImpl as typeof fetch).catch((error) => { failure = error; });
    try {
      await vi.advanceTimersByTimeAsync(8000);
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toMatch(/timed out/i);
    } finally { finish(new Response(null, { status: 204 })); await exchange; }
  });

  it("settles caller cancellation without waiting for an abort-ignoring fetch", async () => {
    let finish!: (value: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const pending = exchangeWebLogin("code", fetchImpl as typeof fetch, controller.signal);
    const refused = expect(pending).rejects.toThrow("canceled");
    controller.abort(); await refused;
    finish(new Response(null, { status: 204 }));
  });

  it("does not invoke fetch for an already retired caller", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn();
    const controller = new AbortController(); controller.abort();
    await expect(exchangeWebLogin("code", fetchImpl as typeof fetch, controller.signal)).rejects.toThrow("canceled");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["success", "HTTP failure", "fetch failure"])("releases its deadline after %s", async (outcome) => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => {
      if (outcome === "fetch failure") throw new Error("Network unavailable");
      return new Response(null, { status: outcome === "success" ? 204 : 503 });
    });
    if (outcome === "success") await exchangeWebLogin("code", fetchImpl as typeof fetch);
    else await expect(exchangeWebLogin("code", fetchImpl as typeof fetch)).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("takes a one-time login code and removes it from the address", () => {
    localStorage.setItem("mains.token", "old-owner-secret");
    window.history.replaceState(null, "", "/#login=single-use-code");

    expect(takeWebLoginCode()).toBe("single-use-code");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("single-use-code");
    expect(localStorage.getItem("mains.token")).toBeNull();
  });

  it("scrubs but never accepts legacy owner-token URLs", () => {
    window.history.replaceState(
      null,
      "",
      "/?view=compact&token=owner-secret#token=another-secret",
    );

    expect(takeWebLoginCode()).toBeUndefined();
    expect(window.location.search).toBe("?view=compact");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("secret");
  });

  it("leaves a router fragment alone and never restores a stored token", () => {
    localStorage.setItem("mains.token", "stored-secret");
    window.history.replaceState(null, "", "/#/spaces/abc");

    expect(takeWebLoginCode()).toBeUndefined();
    expect(window.location.hash).toBe("#/spaces/abc");
    expect(localStorage.getItem("mains.token")).toBeNull();
  });

  it("exchanges the code in an Authorization header without putting it in a URL", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );

    await exchangeWebLogin("single-use-code", fetchImpl as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith(
      "/__mains/web-session",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer single-use-code" },
        credentials: "same-origin",
        redirect: "error",
      }),
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain("single-use-code");
  });
});
