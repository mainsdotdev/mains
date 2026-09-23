// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeWebLogin, takeWebLoginCode } from "./web-login";

describe("browser web login", () => {
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
