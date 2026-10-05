import { afterEach, describe, expect, it } from "vitest";
import { mcpAppsRegistry } from "./mcpApps.registry";

afterEach(() => mcpAppsRegistry.clear());

describe("MCP App origins", () => {
  it("isolates each document and revokes the resource when its app closes", () => {
    const first = new URL(mcpAppsRegistry.register("<main>One</main>", {}));
    const second = new URL(mcpAppsRegistry.register("<main>Two</main>", {}));
    expect(first.hostname).not.toBe(second.hostname);
    expect(first.protocol).toBe("mains-mcp-app:");
    expect(first.pathname).toBe("/index.html");
    expect(mcpAppsRegistry.get(first.hostname)?.html).toContain("One");
    mcpAppsRegistry.remove(first.href);
    expect(mcpAppsRegistry.get(first.hostname)).toBeNull();
    expect(mcpAppsRegistry.get(second.hostname)?.html).toContain("Two");
  });
});
