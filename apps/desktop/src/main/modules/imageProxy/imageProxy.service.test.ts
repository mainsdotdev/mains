import * as dns from "dns";
import { afterEach, describe, it, expect, vi } from "vitest";
import { imageProxyService, isBlockedIp, isImageContentType } from "./imageProxy.service";

describe("signLocalVisualizationUrl", () => {
  it("signs absolute HTML paths and rejects other inputs", () => {
    expect(
      imageProxyService.signLocalVisualizationUrl("/tmp/chart.html"),
    ).toMatch(/^mains-visualize:\/\/view\//);
    expect(imageProxyService.signLocalVisualizationUrl("chart.html")).toBeNull();
    expect(
      imageProxyService.signLocalVisualizationUrl("/tmp/chart.svg"),
    ).toBeNull();
  });
});

describe("matchUrlToGithub (B1: token-leak host match)", () => {
  it("matches real GitHub image hosts", () => {
    for (const url of [
      "https://github.com/u/avatar.png",
      "https://raw.githubusercontent.com/o/r/main/a.png",
      "https://avatars.githubusercontent.com/u/1?v=4",
      "https://user-images.githubusercontent.com/1/x.png",
      "https://private-user-images.githubusercontent.com/1/x.png",
    ]) {
      expect(imageProxyService.matchUrlToGithub(url)).toBe(true);
    }
  });

  it("does NOT match lookalike / attacker hosts that merely end with the domain", () => {
    for (const url of [
      "https://evilgithub.com/x.png",
      "https://notgithub.com/x.png",
      "https://githubusercontent.com.attacker.com/x.png",
      "https://github.com.evil.com/x.png",
      "https://example.com/x.png",
    ]) {
      expect(imageProxyService.matchUrlToGithub(url)).toBe(false);
    }
  });

  it("is case-insensitive and rejects malformed urls", () => {
    expect(imageProxyService.matchUrlToGithub("https://GitHub.com/a.png")).toBe(true);
    expect(imageProxyService.matchUrlToGithub("not a url")).toBe(false);
  });

  it("does NOT send the token to GitHub's data hosts", () => {
    expect(imageProxyService.matchUrlToGithub("https://api.github.com/user/repos")).toBe(false);
    expect(imageProxyService.matchUrlToGithub("https://uploads.github.com/x")).toBe(false);
  });
});

describe("isImageContentType", () => {
  it("accepts image media types, parameters and case aside", () => {
    for (const type of ["image/png", "image/svg+xml", "IMAGE/JPEG", "image/webp; q=1"]) {
      expect(isImageContentType(type), type).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const type of ["text/plain", "application/json", "text/html; charset=utf-8", "image", "", null]) {
      expect(isImageContentType(type), String(type)).toBe(false);
    }
  });
});

describe("safeImageFetch (image-only responses)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function serve(response: Response) {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "185.199.108.133", family: 4 },
    ] as any);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  }

  it("passes an image through", async () => {
    serve(new Response("png", { headers: { "content-type": "image/png" } }));
    const res = await imageProxyService.safeImageFetch(
      "https://raw.githubusercontent.com/o/r/main/a.png",
      null,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png");
  });

  it("drops the body of a non-image even when GitHub answered 200", async () => {
    serve(new Response("SECRET=1", { headers: { "content-type": "text/plain; charset=utf-8" } }));
    const res = await imageProxyService.safeImageFetch(
      "https://raw.githubusercontent.com/o/private/main/.env",
      { Authorization: "token x" },
    );
    expect(res.status).toBe(415);
    expect(await res.text()).toBe("");
  });

  it("keeps an error status but not its body", async () => {
    serve(
      new Response('{"message":"Not Found"}', {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await imageProxyService.safeImageFetch("https://github.com/o/r/x.png", null);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
});

describe("isBlockedIp (B2: SSRF address guard)", () => {
  it("blocks loopback, private, link-local and other non-public ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
      "::1", // IPv6 loopback
      "::", // unspecified
      "fc00::1", // unique-local
      "fd12:3456::1",
      "fe80::1", // link-local
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedIp(ip), `${ip} should be blocked`).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "140.82.112.3", // github.com
      "185.199.108.133", // githubusercontent CDN
      "2606:4700:4700::1111", // public IPv6 (Cloudflare)
    ]) {
      expect(isBlockedIp(ip), `${ip} should be allowed`).toBe(false);
    }
  });

  it("fails closed on unparseable input", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("999.999.999.999")).toBe(true);
  });
});
