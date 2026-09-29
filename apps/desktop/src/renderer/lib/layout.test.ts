import { describe, expect, it } from "vitest";
import { hasSidebarPanel } from "./layout";

describe("hasSidebarPanel", () => {
  it("keeps the list panel for conversations and settings", () => {
    for (const route of ["/", "/code", "/code/runs/123", "/code/workspace-id", "/settings"]) {
      expect(hasSidebarPanel(route)).toBe(true);
    }
  });

  it("gives standalone pages the rail and full content width", () => {
    for (const route of ["/tasks", "/pulse", "/plugins", "/relay", "/unknown"]) {
      expect(hasSidebarPanel(route)).toBe(false);
    }
  });
});
