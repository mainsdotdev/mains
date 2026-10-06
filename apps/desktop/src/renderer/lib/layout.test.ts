import { describe, expect, it } from "vitest";
import { hasSidebarPanel, shouldHideRightPanel, shouldHideWorkspacePanels } from "./layout";

describe("hasSidebarPanel", () => {
  it("keeps the list panel for conversations, settings and Atlas", () => {
    for (const route of ["/", "/code", "/code/runs/123", "/code/workspace-id", "/settings", "/atlas", "/atlas/page-id"]) {
      expect(hasSidebarPanel(route)).toBe(true);
    }
  });

  it("keeps workspace tools out of the Atlas library and editor", () => {
    for (const route of ["/atlas", "/atlas/page-id", "/atlas/images/new"]) {
      expect(shouldHideRightPanel(route)).toBe(false);
      expect(shouldHideWorkspacePanels(route)).toBe(true);
    }
    expect(shouldHideWorkspacePanels("/code/run-1")).toBe(false);
    expect(shouldHideWorkspacePanels("/settings")).toBe(true);
    expect(shouldHideWorkspacePanels("/atlas-other")).toBe(false);
    expect(hasSidebarPanel("/atlas-other")).toBe(false);
  });

  it("gives standalone pages the rail and full content width", () => {
    for (const route of ["/tasks", "/pulse", "/plugins", "/relay", "/unknown"]) {
      expect(hasSidebarPanel(route)).toBe(false);
    }
  });
});
