// @ts-expect-error jsdom is a test-runtime dependency without bundled declarations.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  buildMcpAppContentSecurityPolicy,
  renderMcpAppDocument,
  sanitizeMcpAppResourceCsp,
} from "./mcpApps.document";

describe("MCP App document sandbox", () => {
  it("builds CSP from only the resource-declared network origins", () => {
    const csp = buildMcpAppContentSecurityPolicy({
      connectDomains: [
        "https://api.example.com",
        "wss://stream.example.com",
        "javascript:alert(1)",
      ],
      resourceDomains: [
        "https://cdn.example.com",
        "https://*.images.example.com",
        "https://cdn.example.com/path-is-not-an-origin",
      ],
      frameDomains: ["https://player.example.com"],
    });

    expect(csp).toContain(
      "connect-src https://api.example.com wss://stream.example.com",
    );
    expect(csp).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: https://cdn.example.com https://*.images.example.com",
    );
    expect(csp).toContain("frame-src https://player.example.com");
    expect(csp).not.toContain("javascript:");
    expect(csp).not.toContain("path-is-not-an-origin");
  });

  it("allows only the resource's own origin as the default base URI", () => {
    expect(buildMcpAppContentSecurityPolicy(undefined)).toContain(
      "base-uri 'self'",
    );
  });

  it("returns the same sanitized allowlists that are advertised to the app", () => {
    expect(
      sanitizeMcpAppResourceCsp({
        connectDomains: ["https://api.example.com", "file:///etc/passwd"],
        resourceDomains: ["https://cdn.example.com/path", "https://cdn.example.com"],
      }),
    ).toEqual({
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
    });
  });

  it("injects the compatibility bridge before the app's own scripts", () => {
    const html = renderMcpAppDocument(
      "<!doctype html><html><head><script src=\"https://cdn.example.com/app.js\"></script></head><body></body></html>",
    );

    expect(html).toContain("mains:mcp-app-ready");
    expect(html.indexOf("mains:mcp-app-ready")).toBeLessThan(
      html.indexOf("https://cdn.example.com/app.js"),
    );
  });

  it("wraps an HTML fragment in a complete sandbox document", () => {
    const html = renderMcpAppDocument("<main>Flight results</main>");

    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<main>Flight results</main>");
  });

  it("keeps the bridge after the doctype for body-only documents", () => {
    const html = renderMcpAppDocument(
      "<!doctype html><body><script>window.appStarted = true</script></body>",
    );

    expect(html).toMatch(/^<!doctype html><html><head>/i);
    expect(html.indexOf("mains:mcp-app-ready")).toBeLessThan(
      html.indexOf("window.appStarted"),
    );
  });

  it("routes target-blank web links through the host instead of a sandbox popup", () => {
    const messages: unknown[] = [];
    const html = renderMcpAppDocument(
      '<a id="cta" href="https://www.skyscanner.net/transport/flights" target="_blank">Compare deals</a>',
    );
    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      url: "https://mains.local/widget",
      beforeParse(window: object) {
        Object.defineProperty(window, "matchMedia", {
          value: () => ({ matches: true }),
        });
        Object.defineProperty(window, "requestAnimationFrame", {
          value: (callback: (timestamp: number) => void) => {
            callback(0);
            return 1;
          },
        });
        Object.defineProperty(window, "cancelAnimationFrame", {
          value: () => undefined,
        });
        Object.defineProperty(window, "postMessage", {
          value: (message: unknown) => messages.push(message),
        });
      },
    });

    const click = new dom.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    dom.window.document.querySelector("#cta")?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(messages).toContainEqual({
      type: "mains:mcp-app-request",
      id: 1,
      method: "ui/open-link",
      params: { url: "https://www.skyscanner.net/transport/flights" },
    });
    dom.window.close();
  });
});
