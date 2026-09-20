// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./mcp-app-display", () => ({
  McpAppDisplay: ({ app }: { app: { resourceUri: string } }) =>
    createElement("div", { "data-testid": "mcp-app-host" }, app.resourceUri),
}));

import { McpDisplay } from "./mcp-display";

describe("McpDisplay", () => {
  it("shows a provider-authored MCP App without requiring the JSON details to expand", () => {
    render(
      createElement(McpDisplay, {
        displayName: "Skyscanner flights search",
        icon: createElement("span", null, "icon"),
        params: { origin: "TYO", destination: "SEL" },
        output: { structuredContent: { itineraries: [] } },
        runId: "run-1",
        mcpApp: {
          server: "codex_apps",
          tool: "skyscanner.search",
          resourceUri: "ui://widgets/flights.html",
          originCallId: "call-1",
        },
      }),
    );

    expect(screen.getByTestId("mcp-app-host").textContent).toBe(
      "ui://widgets/flights.html",
    );
  });
});
