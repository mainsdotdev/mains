import { describe, expect, it } from "vitest";
import { mcpAppBrowserHeaders } from "./mcpApps.requestHeaders";

describe("MCP App browser requests", () => {
  it("keeps browser identity consistent while preserving authentication and origin headers", () => {
    const original = {
      "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Mains/0.14.0 Chrome/146.0.0.0 Electron/41.0.0 Safari/537.36",
      "sec-ch-ua": '"Chromium";v="146", "Electron";v="41", "Not A Brand";v="99"',
      Origin: "mains-mcp-app://isolated-app",
      Authorization: "Bearer test-token",
    };
    const result = mcpAppBrowserHeaders(original, "mains");
    expect(result["User-Agent"]).toBe("Mozilla/5.0 AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36");
    expect(result["sec-ch-ua"]).not.toContain("Electron");
    expect(result.Origin).toBe(original.Origin);
    expect(result.Authorization).toBe(original.Authorization);
    expect(original["User-Agent"]).toContain("Electron");
  });
});
